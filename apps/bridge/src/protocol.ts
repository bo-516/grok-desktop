/**
 * Bridge WebSocket protocol: browser ↔ local Node bridge.
 * For multi-session, prompt/cancel/permission should carry sessionId to avoid hitting the wrong process.
 */

import type {
  ContentBlock,
  SessionState,
  SessionStatus,
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
  | { type: "ping" }
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
  | { type: "hello"; cwd: string; port: number; poolCapacity: number }
  | { type: "state"; session: SessionState }
  | { type: "pool"; entries: PoolEntry[] }
  | { type: "environment"; env: EnvironmentInfo }
  | { type: "stderr"; text: string; sessionId?: string }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "info"; message: string; sessionId?: string }
  | {
      type: "workspace_entries";
      requestId: string;
      entries: Array<{ path: string; kind: "file" | "directory" }>;
    }
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
