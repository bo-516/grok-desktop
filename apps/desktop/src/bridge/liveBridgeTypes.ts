/**
 * Shared types for the browser ↔ bridge WebSocket client.
 * Split from liveBridge.ts so the connect module stays under the line limit.
 */

import type { ContentBlock, SessionState } from "@grok-desktop/acp-core";

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

export type { ContentBlock, SessionState };
