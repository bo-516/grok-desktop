/**
 * Browser client for the local Node bridge (real grok agent stdio).
 * Multi-session: prompt/cancel/permission carry sessionId; pool and env-probe callbacks.
 * CLI channel + set_model/set_mode/restart/compact.
 */

import type { ContentBlock, SessionState } from "@grok-desktop/acp-core";

/** Workspace-relative paths scanned by the real bridge for `@` completion. */
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
};

/** Aligned with bridge PoolEntry. */
export type PoolEntry = {
  sessionId: string;
  cwd: string;
  status: SessionState["status"];
  lastUsed: number;
  live: boolean;
};

/** Aligned with bridge EnvironmentInfo; no secret plaintext. */
export type EnvironmentInfo = {
  grokPath: string | null;
  version: string | null;
  authed: boolean;
  authSource: "xai_api_key" | "cached_token" | "none";
  authPathChecked: string;
  ok: boolean;
  message: string;
  poolCapacity: number;
};

export type CliChannelResult = {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type SessionSpawnConfig = {
  model?: string;
  sandbox?: string;
  alwaysApprove?: boolean;
  worktree?: string | boolean;
  ref?: string;
  maxTurns?: number;
  noPlan?: boolean;
  noSubagents?: boolean;
  rules?: string;
  disableWebSearch?: boolean;
  webFetch?: boolean;
  trust?: boolean;
  effort?: string;
  allowRules?: string[];
  denyRules?: string[];
  env?: Record<string, string>;
  extraArgs?: string[];
};

export type BridgeServerMsg =
  | { type: "hello"; cwd: string; port: number; poolCapacity?: number }
  | { type: "state"; session: SessionState }
  | { type: "pool"; entries: PoolEntry[] }
  | { type: "environment"; env: EnvironmentInfo }
  | { type: "stderr"; text: string; sessionId?: string }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "info"; message: string; sessionId?: string }
  | { type: "workspace_entries"; requestId: string; entries: WorkspaceEntry[] }
  | {
      type: "write_workspace_file_result";
      requestId: string;
      ok: boolean;
      error?: string;
    }
  | { type: "cli_result"; result: CliChannelResult }
  | {
      type: "restart_required";
      sessionId: string;
      reason: string;
      setting: string;
    }
  | { type: "pong" };

export type LiveBridgeHandlers = {
  onState: (session: SessionState) => void;
  onPool?: (entries: PoolEntry[]) => void;
  onEnvironment?: (env: EnvironmentInfo) => void;
  onInfo?: (message: string, sessionId?: string) => void;
  onError?: (message: string, sessionId?: string) => void;
  onStderr?: (text: string, sessionId?: string) => void;
  onHello?: (cwd: string, poolCapacity?: number) => void;
  onClose?: () => void;
  onRestartRequired?: (payload: {
    sessionId: string;
    reason: string;
    setting: string;
  }) => void;
};

export type StartOpts = {
  cwd?: string;
  alwaysApprove?: boolean;
  resumeId?: string;
  seed?: SessionState;
  forceNew?: boolean;
  spawnConfig?: SessionSpawnConfig;
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
  listWorkspaceEntries: (query: string) => Promise<WorkspaceEntry[]>;
  /** Write a workspace-relative file (diff review apply). */
  writeWorkspaceFile: (
    path: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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
  const pendingWorkspaceRequests = new Map<
    string,
    {
      resolve: (entries: WorkspaceEntry[]) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingCli = new Map<string, PendingCli>();
  const pendingWrite = new Map<
    string,
    {
      resolve: (r: { ok: boolean; error?: string }) => void;
      reject: (e: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const readyCallbacks: {
    resolve?: () => void;
    reject?: (error: Error) => void;
  } = {};
  const ready = new Promise<void>((resolve, reject) => {
    readyCallbacks.resolve = resolve;
    readyCallbacks.reject = reject;
  });
  const workspaceRequestState = { sequence: 0 };
  const cliRequestState = { sequence: 0 };
  const writeRequestState = { sequence: 0 };

  ws.onopen = () => {
    readyCallbacks.resolve?.();
  };
  ws.onerror = () => {
    rejectWorkspaceRequests(new Error(`WebSocket error connecting to ${url}`));
    rejectCliRequests(new Error(`WebSocket error connecting to ${url}`));
    rejectWriteRequests(new Error(`WebSocket error connecting to ${url}`));
    readyCallbacks.reject?.(new Error(`WebSocket error connecting to ${url}`));
    handlers.onError?.(`WebSocket error: ${url}`);
  };
  ws.onclose = () => {
    rejectWorkspaceRequests(new Error("Bridge WebSocket closed"));
    rejectCliRequests(new Error("Bridge WebSocket closed"));
    rejectWriteRequests(new Error("Bridge WebSocket closed"));
    handlers.onClose?.();
  };
  ws.onmessage = (ev) => {
    let msg: BridgeServerMsg;
    try {
      msg = JSON.parse(String(ev.data)) as BridgeServerMsg;
    } catch {
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
    } else if (msg.type === "workspace_entries") {
      const pending = pendingWorkspaceRequests.get(msg.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingWorkspaceRequests.delete(msg.requestId);
      pending.resolve(msg.entries);
    } else if (msg.type === "cli_result") {
      const pending = pendingCli.get(msg.result.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingCli.delete(msg.result.requestId);
      pending.resolve(msg.result);
    } else if (msg.type === "write_workspace_file_result") {
      const pending = pendingWrite.get(msg.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingWrite.delete(msg.requestId);
      pending.resolve({ ok: msg.ok, error: msg.error });
    }
  };

  const send = (message: unknown): boolean => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  };

  const listWorkspaceEntries = (query: string): Promise<WorkspaceEntry[]> => {
    workspaceRequestState.sequence += 1;
    const requestId = `workspace-${workspaceRequestState.sequence}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWorkspaceRequests.delete(requestId);
        reject(new Error("Workspace entries request timed out"));
      }, 5000);
      pendingWorkspaceRequests.set(requestId, { resolve, reject, timeout });
      if (send({ type: "list_workspace_entries", requestId, query })) {
        return;
      }
      clearTimeout(timeout);
      pendingWorkspaceRequests.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
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

  function rejectWorkspaceRequests(error: Error): void {
    for (const pending of pendingWorkspaceRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingWorkspaceRequests.clear();
  }

  function rejectCliRequests(error: Error): void {
    for (const pending of pendingCli.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingCli.clear();
  }

  function rejectWriteRequests(error: Error): void {
    for (const pending of pendingWrite.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingWrite.clear();
  }

  /**
   * Write content to a path under the session workspace (boundary enforced on bridge).
   * @param filePath Workspace-relative path.
   * @param content Full file text after hunk decisions.
   */
  const writeWorkspaceFile = (
    filePath: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    writeRequestState.sequence += 1;
    const requestId = `write-${writeRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWrite.delete(requestId);
        reject(new Error("write_workspace_file timed out"));
      }, 15_000);
      pendingWrite.set(requestId, { resolve, reject, timeout });
      if (
        send({
          type: "write_workspace_file",
          requestId,
          path: filePath,
          content,
        })
      ) {
        return;
      }
      clearTimeout(timeout);
      pendingWrite.delete(requestId);
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
    listWorkspaceEntries,
    writeWorkspaceFile,
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
