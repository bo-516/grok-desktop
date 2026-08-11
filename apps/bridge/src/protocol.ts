/**
 * Bridge WebSocket protocol: browser ↔ local Node bridge.
 * For multi-session, prompt/cancel/permission should carry sessionId to avoid hitting the wrong process.
 */

import type {
  ContentBlock,
  PermissionRequest,
  SessionState,
  SessionStatus,
  SessionUpdate,
} from "@grok-desktop/acp-core";
import type { SessionSpawnConfig } from "./sessionRuntime.js";

/** Single pool runtime summary for UI rail status lights and LRU diagnostics. */
export type PoolEntry = {
  sessionId: string;
  cwd: string;
  status: SessionStatus;
  lastUsed: number;
  /** Whether the process is still resident (true means not reclaimed). */
  live: boolean;
};

/** CLI / login probe result; secrets are never sent to the browser. */
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

/** Generic CLI/channel RPC result for inspect/sessions/mcp/worktree. */
export type CliChannelResult = {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

/** Browser → bridge. */
export type ClientMsg =
  | {
      type: "start";
      cwd?: string;
      alwaysApprove?: boolean;
      resumeId?: string;
      seed?: SessionState;
      forceNew?: boolean;
      /** SPAWN flags applied at process start / restart. */
      spawnConfig?: SessionSpawnConfig;
    }
  | {
      type: "prompt";
      text: string;
      sessionId?: string;
      /** Multi-block prompt (image / resource_link). */
      blocks?: ContentBlock[];
    }
  | { type: "cancel"; sessionId?: string }
  | { type: "permission"; optionId: string; sessionId?: string }
  | { type: "close_session"; sessionId: string }
  | { type: "list_pool" }
  | { type: "check_environment" }
  | { type: "list_workspace_entries"; requestId: string; query: string; cwd?: string }
  /** Write text under workspace cwd (F-NATIVE-06 apply accepted hunks). */
  | {
      type: "write_workspace_file";
      requestId: string;
      path: string;
      content: string;
      cwd?: string;
    }
  /**
   * Read text under workspace cwd for @mention embedding.
   * Guards (sensitive / size / binary / directory / path sandbox) run on bridge only.
   */
  | {
      type: "read_workspace_file";
      requestId: string;
      path: string;
      cwd?: string;
    }
  /**
   * Read text for the preview drawer. Oversize truncates (does not hard-fail);
   * sensitive / binary / directory / outside still reject with reason.
   */
  | {
      type: "preview_workspace_file";
      requestId: string;
      path: string;
      cwd?: string;
      /** Optional ceiling in bytes (capped server-side at 1MB). */
      maxBytes?: number;
    }
  | { type: "ping" }
  /**
   * On-demand full SessionState snapshot (reconnect / multi-window).
   * Hot-path streaming uses session_update relay instead.
   */
  | { type: "get_state"; sessionId?: string }
  /** Mid-session ACP set_model when supported. */
  | { type: "set_model"; sessionId?: string; modelId: string }
  /** Mid-session ACP set_mode when supported. */
  | { type: "set_mode"; sessionId?: string; modeId: string }
  | { type: "compact"; sessionId?: string; instruction?: string }
  | { type: "token_usage"; sessionId?: string; requestId: string }
  /** Restart process with new SPAWN config + session/load (J-06). */
  | {
      type: "restart_session";
      sessionId: string;
      spawnConfig?: SessionSpawnConfig;
      alwaysApprove?: boolean;
    }
  /** One-shot CLI channel (inspect / sessions / mcp / worktree / export / auth). */
  | {
      type: "cli";
      requestId: string;
      command:
        | "inspect"
        | "sessions_list"
        | "sessions_search"
        | "sessions_delete"
        | "export"
        | "mcp_list"
        | "mcp_doctor"
        | "mcp_add_stdio"
        | "mcp_remove"
        | "worktree_list"
        | "worktree_rm"
        | "worktree_gc"
        | "models_list"
        | "memory_clear"
        | "auth_login"
        | "auth_logout"
        | "update_check"
        | "hooks_trust"
        | "mcp_add_http"
        | "plugin"
        | "marketplace"
        | "mcp_stderr_log"
        | "import_claude";
      args?: Record<string, unknown>;
      cwd?: string;
    };

/** bridge → browser. */
export type ServerMsg =
  | {
      type: "hello";
      cwd: string;
      port: number;
      poolCapacity: number;
      /** Which bridge binary is serving (cold switch observability). */
      impl: "node" | "go";
      /** Bridge package / build version string. */
      version: string;
    }
  /**
   * Full SessionState: hydrate after start/resume, reconnect, or get_state.
   * Not the hot path — streaming uses session_update.
   */
  | { type: "state"; session: SessionState }
  /**
   * Raw ACP session/update relay. Client rebuilds SessionState via
   * applySessionUpdate + eventId set dedupe (ids are non-monotonic under task_*).
   */
  | {
      type: "session_update";
      sessionId: string;
      update: SessionUpdate;
      /** Wire `_meta.eventId` when present; used for set-based dedupe. */
      eventId?: string;
    }
  /**
   * Lifecycle side channel when status / pendingPermission change without a
   * corresponding session_update (settle quiet window, permission reverse RPC).
   */
  | {
      type: "session_lifecycle";
      sessionId: string;
      status: SessionStatus;
      pendingPermission?: PermissionRequest | null;
      model?: string;
      mode?: SessionState["mode"];
    }
  /**
   * session/load replay window opened. UI freezes canvas fan-out for this
   * sessionId only (other sessions keep streaming). Paired with replay_end.
   */
  | {
      type: "replay_begin";
      sessionId: string;
    }
  /**
   * session/load replay window closed. Node fills `session` (already reduced);
   * Go fills ordered `updates` (no timeline on the Go bridge). Authoritative
   * status/model/mode override batch-reduce streaming residue (composer Stop).
   * Multiple ends for one session are legal when the buffer hits size caps.
   */
  | {
      type: "replay_end";
      sessionId: string;
      /** Reduced full snapshot (Node path). */
      session?: SessionState;
      /** Raw ordered updates from the load window (Go path). */
      updates?: { update: SessionUpdate; eventId?: string }[];
      /** Authoritative post-load status (Go path required; Node usually idle). */
      status: SessionStatus;
      model?: string;
      mode?: SessionState["mode"];
      /** Observability: number of updates absorbed in this window/chunk. */
      count: number;
      /** Observability: approximate UTF-8 byte size of buffered updates. */
      bytes: number;
      /** Observability: wall time from begin to this end (ms). */
      elapsedMs: number;
    }
  | { type: "pool"; entries: PoolEntry[] }
  | { type: "environment"; env: EnvironmentInfo }
  | { type: "stderr"; text: string; sessionId?: string }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "info"; message: string; sessionId?: string }
  | {
      type: "workspace_entries";
      requestId: string;
      entries: Array<{
        path: string;
        kind: "file" | "directory";
        /** true when git check-ignore reports ignored; undefined when unknown. */
        ignored?: boolean;
      }>;
    }
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
