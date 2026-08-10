/**
 * Browser client for the local Node bridge (real grok agent stdio).
 * Multi-session: prompt/cancel/permission carry sessionId; pool and env-probe callbacks.
 * CLI channel + set_model/set_mode/restart/compact. Workspace FS helpers live in liveBridgeFs.
 */

import type { ContentBlock } from "@grok-desktop/acp-core";
import { createLiveBridgeFs } from "./liveBridgeFs";
import type {
  BridgeServerMsg,
  CliChannelResult,
  EnvironmentInfo,
  LiveBridgeHandlers,
  PoolEntry,
  PreviewWorkspaceFileResult,
  ReadWorkspaceFileResult,
  SessionSpawnConfig,
  StartOpts,
  WorkspaceEntry,
} from "./liveBridgeTypes";

export type {
  BridgeServerMsg,
  CliChannelResult,
  EnvironmentInfo,
  LiveBridgeHandlers,
  PoolEntry,
  ReadWorkspaceFileResult,
  SessionSpawnConfig,
  StartOpts,
  WorkspaceEntry,
};

type PendingCli = {
  resolve: (result: CliChannelResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * Connect to the real local bridge and expose multi-session control.
 * @param url Bridge WebSocket URL.
 * @param handlers State / pool / environment callbacks.
 */
export function connectLiveBridge(
  url: string,
  handlers: LiveBridgeHandlers,
): {
  start: (opts?: StartOpts) => boolean;
  prompt: (
    text: string,
    sessionId?: string,
    blocks?: ContentBlock[],
  ) => boolean;
  cancel: (sessionId?: string) => void;
  permission: (optionId: string, sessionId?: string) => void;
  closeSession: (sessionId: string) => boolean;
  listPool: () => boolean;
  checkEnvironment: () => boolean;
  /**
   * `@` completion index.
   * @param query Fragment after `@`.
   * @param cwd Workspace to index. Omit only when no session is known — the
   *   bridge then falls back to the last started session's cwd, which with a
   *   multi-session pool may not be the workspace on screen.
   */
  listWorkspaceEntries: (
    query: string,
    cwd?: string,
  ) => Promise<WorkspaceEntry[]>;
  /** Write a workspace-relative file (diff review apply). */
  writeWorkspaceFile: (
    path: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Read a workspace-relative file for @mention embedding.
   * Guards (sensitive / size / binary / sandbox) run on the bridge.
   */
  readWorkspaceFile: (
    path: string,
    cwd?: string,
  ) => Promise<ReadWorkspaceFileResult>;
  /**
   * Read a workspace file for the preview drawer (may truncate with flag).
   * Sensitive / binary / outside still reject with reason.
   */
  previewWorkspaceFile: (
    path: string,
    cwd?: string,
    maxBytes?: number,
  ) => Promise<PreviewWorkspaceFileResult>;
  setModel: (modelId: string, sessionId?: string) => boolean;
  setMode: (modeId: string, sessionId?: string) => boolean;
  compact: (instruction?: string, sessionId?: string) => boolean;
  restartSession: (
    sessionId: string,
    spawnConfig?: SessionSpawnConfig,
    alwaysApprove?: boolean,
  ) => boolean;
  cli: (
    command: string,
    args?: Record<string, unknown>,
    cwd?: string,
  ) => Promise<CliChannelResult>;
  close: () => void;
  ready: Promise<void>;
} {
  const ws = new WebSocket(url);
  const pendingCli = new Map<string, PendingCli>();
  const readyCallbacks: {
    resolve?: () => void;
    reject?: (error: Error) => void;
  } = {};
  const ready = new Promise<void>((resolve, reject) => {
    readyCallbacks.resolve = resolve;
    readyCallbacks.reject = reject;
  });
  const cliRequestState = { sequence: 0 };

  const send = (message: unknown): boolean => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  };

  const fsApi = createLiveBridgeFs(send);

  function rejectCliRequests(error: Error): void {
    for (const pending of pendingCli.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingCli.clear();
  }

  ws.onopen = () => {
    readyCallbacks.resolve?.();
  };
  ws.onerror = () => {
    fsApi.rejectAll(new Error(`WebSocket error connecting to ${url}`));
    rejectCliRequests(new Error(`WebSocket error connecting to ${url}`));
    readyCallbacks.reject?.(new Error(`WebSocket error connecting to ${url}`));
    handlers.onError?.(`WebSocket error: ${url}`);
  };
  ws.onclose = () => {
    fsApi.rejectAll(new Error("Bridge WebSocket closed"));
    rejectCliRequests(new Error("Bridge WebSocket closed"));
    handlers.onClose?.();
  };
  ws.onmessage = (ev) => {
    let msg: BridgeServerMsg;
    try {
      msg = JSON.parse(String(ev.data)) as BridgeServerMsg;
    } catch {
      return;
    }
    if (fsApi.handleServerMsg(msg)) {
      return;
    }
    if (msg.type === "state") {
      handlers.onState(msg.session);
    } else if (msg.type === "pool") {
      handlers.onPool?.(msg.entries);
    } else if (msg.type === "environment") {
      handlers.onEnvironment?.(msg.env);
    } else if (msg.type === "info") {
      handlers.onInfo?.(msg.message, msg.sessionId);
    } else if (msg.type === "error") {
      handlers.onError?.(msg.message, msg.sessionId);
    } else if (msg.type === "stderr") {
      handlers.onStderr?.(msg.text, msg.sessionId);
    } else if (msg.type === "hello") {
      handlers.onHello?.(msg.cwd, msg.poolCapacity);
    } else if (msg.type === "restart_required") {
      handlers.onRestartRequired?.(msg);
    } else if (msg.type === "cli_result") {
      const pending = pendingCli.get(msg.result.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingCli.delete(msg.result.requestId);
      pending.resolve(msg.result);
    }
  };

  /**
   * One-shot CLI channel (inspect / sessions / mcp / …).
   * @param command Bridge command id.
   * @param args Optional args bag.
   * @param cwd Optional workspace.
   */
  const cli = (
    command: string,
    args?: Record<string, unknown>,
    cwd?: string,
  ): Promise<CliChannelResult> => {
    cliRequestState.sequence += 1;
    const requestId = `cli-${cliRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCli.delete(requestId);
        reject(new Error(`CLI ${command} timed out`));
      }, 120_000);
      pendingCli.set(requestId, { resolve, reject, timeout });
      if (send({ type: "cli", requestId, command, args, cwd })) {
        return;
      }
      clearTimeout(timeout);
      pendingCli.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  return {
    ready,
    start: (opts) =>
      send({
        type: "start",
        cwd: opts?.cwd,
        alwaysApprove: opts?.alwaysApprove ?? false,
        resumeId: opts?.resumeId,
        seed: opts?.seed,
        forceNew: opts?.forceNew,
        spawnConfig: opts?.spawnConfig,
      }),
    prompt: (text, sessionId, blocks) =>
      send({ type: "prompt", text, sessionId, blocks }),
    cancel: (sessionId) => {
      send({ type: "cancel", sessionId });
    },
    permission: (optionId, sessionId) => {
      send({ type: "permission", optionId, sessionId });
    },
    closeSession: (sessionId) => send({ type: "close_session", sessionId }),
    listPool: () => send({ type: "list_pool" }),
    checkEnvironment: () => send({ type: "check_environment" }),
    listWorkspaceEntries: fsApi.listWorkspaceEntries,
    writeWorkspaceFile: fsApi.writeWorkspaceFile,
    readWorkspaceFile: fsApi.readWorkspaceFile,
    previewWorkspaceFile: fsApi.previewWorkspaceFile,
    setModel: (modelId, sessionId) =>
      send({ type: "set_model", modelId, sessionId }),
    setMode: (modeId, sessionId) =>
      send({ type: "set_mode", modeId, sessionId }),
    compact: (instruction, sessionId) =>
      send({ type: "compact", instruction, sessionId }),
    restartSession: (sessionId, spawnConfig, alwaysApprove) =>
      send({
        type: "restart_session",
        sessionId,
        spawnConfig,
        alwaysApprove,
      }),
    cli,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Default bridge URL (dev). Overridable via VITE_BRIDGE_URL. */
export function defaultBridgeUrl(): string {
  return (
    (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env
      ?.VITE_BRIDGE_URL ?? "ws://127.0.0.1:8765"
  );
}
