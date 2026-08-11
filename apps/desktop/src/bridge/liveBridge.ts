/**
 * Browser client for the local Node bridge (real grok agent stdio).
 * Multi-session: prompt/cancel/permission carry sessionId; pool and env-probe callbacks.
 * CLI channel + set_model/set_mode/restart/compact. Workspace FS helpers live in liveBridgeFs.
 *
 * Relay protocol: hot-path streaming arrives as session_update; this client reduces
 * via applySessionUpdate + eventId set dedupe and surfaces SessionState to handlers.
 */

import type { ContentBlock, SessionState } from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "./liveBridgeDispatch";
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

export {
  createLiveBridgeDispatch,
  makeAgentChunkUpdates,
  REPLAY_TIMEOUT_MS,
} from "./liveBridgeDispatch";

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
    cwd?: string,
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
  /** Relay reduce + load-replay batching (shipped path; unit-tested via createLiveBridgeDispatch). */
  const dispatch = createLiveBridgeDispatch({ handlers });
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
    // I4: do not leave sessions muted if error aborts a load window.
    dispatch.flushAllReplays();
    readyCallbacks.reject?.(new Error(`WebSocket error connecting to ${url}`));
    handlers.onError?.(`WebSocket error: ${url}`);
  };
  ws.onclose = () => {
    fsApi.rejectAll(new Error("Bridge WebSocket closed"));
    rejectCliRequests(new Error("Bridge WebSocket closed"));
    // I4: force-close any open replay windows before clearing buckets.
    dispatch.flushAllReplays();
    dispatch.clearBuckets();
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
    if (dispatch.handleServerMsg(msg)) {
      return;
    }
    if (msg.type === "cli_result") {
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
    start: (opts) => {
      // Prefill client reduce from catalog seed so Go pool-hit (empty timeline)
      // + later live chunks append instead of replacing painted history.
      if (opts?.seed?.id) {
        dispatch.seedSession(opts.seed);
      }
      return send({
        type: "start",
        cwd: opts?.cwd,
        alwaysApprove: opts?.alwaysApprove ?? false,
        resumeId: opts?.resumeId,
        seed: opts?.seed,
        forceNew: opts?.forceNew,
        spawnConfig: opts?.spawnConfig,
      });
    },
    /**
     * Prefill the client reduce bucket (e.g. optimistic user row with image
     * ContentBlocks) so `user_message_chunk` absorbs into that row instead of
     * creating a text-only agent bubble that drops thumbs mid-turn.
     * @param session Canvas session snapshot; must carry a non-empty id.
     */
    seedSession: (session: SessionState) => {
      dispatch.seedSession(session);
    },
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

/**
 * Default bridge URL (dev / packaged shell).
 * Priority: window.__GROK_BRIDGE_URL__ (Wails shell inject) → VITE_BRIDGE_URL
 * → VITE_BRIDGE_TOKEN on default port → bare ws://127.0.0.1:8765 (dev only).
 */
export function defaultBridgeUrl(): string {
  // Packaged shell injects the per-start tokenized URL before the app boots.
  if (typeof window !== "undefined") {
    const injected = (
      window as unknown as { __GROK_BRIDGE_URL__?: string }
    ).__GROK_BRIDGE_URL__;
    if (typeof injected === "string" && injected.trim()) {
      return injected.trim();
    }
  }
  const envUrl = (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env
    ?.VITE_BRIDGE_URL;
  if (envUrl) {
    return envUrl;
  }
  // Dev convenience: match bridge default port; token must be in env for auth.
  const token = (
    import.meta as { env?: { VITE_BRIDGE_TOKEN?: string } }
  ).env?.VITE_BRIDGE_TOKEN;
  if (token) {
    return `ws://127.0.0.1:8765?token=${encodeURIComponent(token)}`;
  }
  return "ws://127.0.0.1:8765";
}
