/**
 * Shared types for the browser ↔ bridge WebSocket client.
 * Split from liveBridge.ts so the connect module stays under the line limit.
 */

import type {
  AgentMode,
  ContentBlock,
  PermissionRequest,
  SessionState,
  SessionStatus,
  SessionUpdate,
} from "@grok-desktop/acp-core";

/** Workspace-relative paths scanned by the real bridge for `@` completion. */
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
  /** true when git check-ignore reports ignored; undefined when unknown. */
  ignored?: boolean;
};

/** Result of bridge read_workspace_file for mention embedding. */
export type ReadWorkspaceFileResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  bytes: number;
  reason?: string;
  error?: string;
};

/** Result of bridge preview_workspace_file for the preview drawer. */
export type PreviewWorkspaceFileResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  /** Full file size on disk (not the truncated length). */
  bytes: number;
  /** True when content was cut at the preview ceiling. */
  truncated?: boolean;
  reason?: string;
  error?: string;
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
  | {
      type: "hello";
      cwd: string;
      port: number;
      poolCapacity?: number;
      impl?: "node" | "go";
      version?: string;
    }
  | { type: "state"; session: SessionState }
  | {
      type: "session_update";
      sessionId: string;
      update: SessionUpdate;
      eventId?: string;
    }
  | {
      type: "session_lifecycle";
      sessionId: string;
      status: SessionStatus;
      pendingPermission?: PermissionRequest | null;
      model?: string;
      mode?: AgentMode;
    }
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
  | {
      type: "read_workspace_file_result";
      requestId: string;
      ok: boolean;
      content?: string;
      mimeType?: string;
      bytes: number;
      reason?: string;
      error?: string;
    }
  | {
      type: "preview_workspace_file_result";
      requestId: string;
      ok: boolean;
      content?: string;
      mimeType?: string;
      bytes: number;
      truncated?: boolean;
      reason?: string;
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
  /** Full hydrate snapshot (start / reconnect / get_state). */
  onState: (session: SessionState) => void;
  /**
   * Raw ACP update after client-side reduce (relay path).
   * session is the post-reduce SessionState for that sessionId.
   */
  onSessionUpdate?: (
    session: SessionState,
    meta: { sessionId: string; eventId?: string; applied: boolean },
  ) => void;
  onPool?: (entries: PoolEntry[]) => void;
  onEnvironment?: (env: EnvironmentInfo) => void;
  onInfo?: (message: string, sessionId?: string) => void;
  onError?: (message: string, sessionId?: string) => void;
  onStderr?: (text: string, sessionId?: string) => void;
  onHello?: (
    cwd: string,
    poolCapacity?: number,
    meta?: { impl?: "node" | "go"; version?: string },
  ) => void;
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

export type { ContentBlock, SessionState };
