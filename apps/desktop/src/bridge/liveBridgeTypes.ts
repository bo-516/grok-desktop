/**
 * Shared types for the browser ↔ bridge WebSocket client.
 * Split from liveBridge.ts so the connect module stays under the line limit.
 */

import type {
  AgentMode,
  AvailableModel,
  ContentBlock,
  PermissionRequest,
  SessionState,
  SessionStatus,
  SessionUpdate,
} from "@grok-desktop/acp-core";
import type {
  LiveBridgeTerminal,
  TerminalServerMsg,
} from "./liveBridgeTerminalTypes";

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

/**
 * Aligned with bridge AuthProbe — the cheap auth-only slice of
 * {@link EnvironmentInfo}, answered by `check_auth` without spawning the CLI.
 * This is what the 3s login poll reads; the full environment probe stays
 * event-driven because it shells out to `grok --version`.
 */
export type AuthProbe = {
  /** True when the bridge host has a usable credential. */
  authed: boolean;
  /** Which credential won; `none` when logged out. */
  authSource: EnvironmentInfo["authSource"];
  /** Absolute cached-token path the bridge stat-ed. */
  authPathChecked: string;
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
      impl?: "go";
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
  /**
   * session/load replay opened; freeze per-update store notify for this session.
   */
  | {
      type: "replay_begin";
      sessionId: string;
    }
  /**
   * session/load replay closed. Node sends `session`; Go sends ordered `updates`.
   * Multiple ends per session are legal when the bridge hits buffer caps.
   */
  | {
      type: "replay_end";
      sessionId: string;
      session?: SessionState;
      updates?: Array<{ update: SessionUpdate; eventId?: string }>;
      status: SessionStatus;
      model?: string;
      mode?: AgentMode;
      count: number;
      bytes: number;
      elapsedMs: number;
    }
  | { type: "pool"; entries: PoolEntry[] }
  | { type: "environment"; env: EnvironmentInfo }
  | { type: "auth_state"; auth: AuthProbe }
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
  | { type: "pong" }
  /**
   * Answer to `read_model_catalog`. configOptions is empty when the snapshot
   * came from initialize alone. ok false carries error and no catalog.
   */
  | {
      type: "model_catalog";
      requestId: string;
      ok: boolean;
      model?: string;
      availableModels?: AvailableModel[];
      configOptions?: unknown[];
      error?: string;
    }
  /** Integrated terminal frames (see liveBridgeTerminalTypes). */
  | TerminalServerMsg;

/**
 * Correlated reply for `read_model_catalog`.
 * availableModels follows the ACP catalog shape. An empty list with ok true
 * means the agent answered and advertised nothing — do not invent rows.
 */
export type ModelCatalogReply = {
  requestId: string;
  ok: boolean;
  model?: string;
  availableModels?: AvailableModel[];
  configOptions?: unknown[];
  error?: string;
};

export type LiveBridgeHandlers = {
  /**
   * Full hydrate snapshot (start / reconnect / get_state / replay_end).
   * `recency: "passive"` means disk/load replay — catalog must not jump
   * the row to now.
   */
  onState: (
    session: SessionState,
    meta?: { recency?: "live" | "passive" },
  ) => void;
  /**
   * Raw ACP update after client-side reduce (relay path).
   * session is the post-reduce SessionState for that sessionId.
   */
  onSessionUpdate?: (
    session: SessionState,
    meta: { sessionId: string; eventId?: string; applied: boolean },
  ) => void;
  /**
   * Whether a session owns the painted canvas. connectLiveBridge coalesces
   * its stream notifies per animation frame; other sessions use the slower
   * background lane. Omitted → every session is treated as foreground.
   * @param sessionId Wire session id ("" for the provisional bucket).
   */
  isForegroundSession?: (sessionId: string) => boolean;
  onPool?: (entries: PoolEntry[]) => void;
  onEnvironment?: (env: EnvironmentInfo) => void;
  /**
   * Login-state tick from `check_auth`. Fires on every poll, so consumers
   * must treat it as idempotent and only react to an actual change.
   */
  onAuthState?: (auth: AuthProbe) => void;
  onInfo?: (message: string, sessionId?: string) => void;
  onError?: (message: string, sessionId?: string) => void;
  onStderr?: (text: string, sessionId?: string) => void;
  onHello?: (
    cwd: string,
    poolCapacity?: number,
    meta?: { impl?: "go"; version?: string },
  ) => void;
  onClose?: () => void;
  onRestartRequired?: (payload: {
    sessionId: string;
    reason: string;
    setting: string;
  }) => void;
};

/**
 * Methods on a connected live bridge. Catalog reads are initialize-only and
 * do not start a session. Boolean methods return false when the socket is down.
 */
export type LiveBridgeHandle = {
  start: (opts?: StartOpts) => boolean;
  /**
   * Emit every coalesced stream notify now. Call before a session switch,
   * remove or disconnect so the store holds the latest reduced state.
   * Optional so test doubles may omit it.
   */
  flushPendingUpdates?: () => void;
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
   * Cheap login-state probe (`check_auth` → `auth_state`). Safe on the 3s
   * poll cadence because the bridge answers from an env read plus one stat;
   * `checkEnvironment` spawns `grok --version` and must stay event-driven.
   * @returns False when the socket is not open (the tick is simply skipped).
   */
  checkAuth: () => boolean;
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
  /**
   * Branch the session into a peer (`_x.ai/session/fork` via bridge).
   * @param sessionId Source session; omit to use the focused bridge session.
   * @param opts Optional source/new cwd overrides.
   * @returns cli_result envelope; `data` holds `{ newSessionId, … }` on success.
   */
  forkSession: (
    sessionId?: string,
    opts?: { sourceCwd?: string; newCwd?: string },
  ) => Promise<CliChannelResult>;
  /**
   * Account weekly remaining (`_x.ai/billing` via bridge).
   * @param sessionId Live session whose process carries the RPC; omit for focused.
   * @returns cli_result envelope; `data` is the credits-config bag on success.
   */
  billing: (sessionId?: string) => Promise<CliChannelResult>;
  /**
   * Session context occupancy (`session/token_usage` via bridge).
   * @param sessionId Live session whose process carries the RPC; omit for focused.
   * @returns cli_result envelope; `data` is the usage bag on success.
   */
  tokenUsage: (sessionId?: string) => Promise<CliChannelResult>;
  restartSession: (
    sessionId: string,
    spawnConfig?: SessionSpawnConfig,
    alwaysApprove?: boolean,
  ) => boolean;
  /**
   * Prefill the client reduce bucket (optimistic user row / seed canvas).
   * @param session Canvas session snapshot; must carry a non-empty id.
   */
  seedSession: (session: SessionState) => void;
  cli: (
    command: string,
    args?: Record<string, unknown>,
    cwd?: string,
  ) => Promise<CliChannelResult>;
  /**
   * Initialize-only model catalog. Does not start a session.
   * @param cwd Optional workspace passed to the probe child.
   */
  readModelCatalog: (cwd?: string) => Promise<ModelCatalogReply>;
  /** Integrated terminal panel: PTY shells owned by this socket. */
  terminal: LiveBridgeTerminal;
  close: () => void;
  ready: Promise<void>;
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
