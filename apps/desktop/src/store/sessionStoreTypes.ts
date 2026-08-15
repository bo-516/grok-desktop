/**
 * Zustand session store shape and shared result types.
 * Implementation lives in sessionStore + action modules.
 */

import type {
  AgentMode,
  ContentBlock,
  SessionBillingSnapshot,
  SessionState,
} from "@grok-desktop/acp-core";
import type { AuthProbe, EnvironmentInfo, PoolEntry } from "../bridge/liveBridge";
import type { SessionRecord } from "./sessionCatalog";
import type {
  ConnectionMode,
  LiveHandle,
} from "./sessionStoreLive";
import type { SessionRoleIndex } from "./sessionRoles";
import type { SessionProvenanceIndex } from "./sessionProvenance";
import type { StartOpts } from "./sessionStoreSupport";
import type { PromptQueueItem } from "@/lib/promptQueue";
import type { WeeklyUsageOutcome } from "@/lib/weeklyUsagePoll";

export type { AuthProbe, ConnectionMode, EnvironmentInfo, PoolEntry };
export type { ContentBlock, SessionState, SessionRecord };
export type { PromptQueueItem };

/** Result of {@link SessionStore.setWorkspace} (empty-session project switch). */
export type SetWorkspaceResult =
  | { ok: true }
  | { ok: false; reason: "locked" };

/** Full Zustand session store contract (LIVE grok-build only). */
export type SessionStore = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /**
   * True when the open canvas is a harness-spawned subagent chat.
   * Sending into it would fight the parent's orchestrator, so the composer
   * disables and the top-nav shows a breadcrumb back to the parent.
   * Derived once in selectSessionAction / newSession; consumers must not
   * re-derive from sessionKind in each widget.
   */
  viewingSubagent: boolean;
  /** Parent chat id for the breadcrumb; undefined when the link is unknown. */
  viewingParentSessionId?: string;
  /**
   * childSessionId → parent linkage from live subagent cards and disk rows.
   * First-hand before sessions_list; used for rail filter and child routing.
   */
  sessionRoles: SessionRoleIndex;
  /**
   * In-memory buffers for known child sessions while streaming.
   * Not persisted; promoted to catalog on terminal / drill-down / flush.
   */
  childSessions: Record<string, SessionState>;
  /**
   * sessionId → provenance. Wire is default (not stored). Only local /
   * resumed / disk may enter the catalog and session rail.
   */
  sessionProvenance: SessionProvenanceIndex;
  /**
   * Unproven wire-only session buffers (memory only). Claimed by
   * subagent_spawned, sessions_list, or disconnect/hide flush.
   */
  pendingSessions: Record<string, SessionState>;
  /** Oldest-first keys of pendingSessions for bounded eviction. */
  pendingSessionOrder: string[];
  /**
   * Bumped when catalog row identity changes in a way Agents openable-id
   * sets must recompute; avoids depending on the catalog array reference.
   */
  catalogRevision: number;
  poolEntries: PoolEntry[];
  environment: EnvironmentInfo | null;
  /**
   * Login state, and the single source of truth the login gate reads.
   *
   * null means "not probed yet" — the gate must stay closed then, or a cold
   * start would flash the sign-in modal at every launch before the first
   * answer lands. Written by both the full `environment` probe and the 3s
   * `auth_state` poll, so a `grok login` / `grok logout` run outside the app
   * still lands here within one tick.
   */
  authed: boolean | null;
  /**
   * Last successful `_x.ai/billing` snapshot (account weekly / monthly remaining).
   * Shared across sessions; kept as last-known-good when a later fetch fails.
   */
  weeklyUsage: SessionBillingSnapshot | null;
  /**
   * True after New chat until the first send (or the user selects another row).
   * Empty canvas + no viewing id alone is not enough — cold reconnect also
   * starts empty and must still accept the first inbound session.
   */
  localDraft: boolean;
  /**
   * True while the first send of a New chat draft is calling forceNew and
   * waiting for the canvas session id. Lets onState accept the fresh empty
   * session without letting other pool residents repaint the draft.
   */
  creatingSession: boolean;
  /**
   * Mode the user requested that is not yet confirmed by the agent.
   * Non-null while a mode switch is in flight; UI keeps the short target mode
   * label + busy chrome, cleared on current_mode_update match or timeout.
   */
  pendingMode: AgentMode | null;
  /**
   * Session whose history is being restored with nothing cached to show yet.
   * Set when the seed timeline is empty (disk-sync stubs). Cleared by the
   * first inbound snapshot that carries content — usually disk hydrate
   * (`session_history`), otherwise session/load replay.
   */
  restoringSessionId: string | null;
  startLiveBridge: (opts?: StartOpts) => Promise<void>;
  /**
   * Open a local New chat draft (empty canvas, no bridge session/new).
   * The real session is created only when the user actually sends a message.
   * Always focuses the composer so every entry (rail, ⌘N, palette, ⋯) lands
   * in the input. Optional `cwd` overrides the default project; when omitted,
   * uses workspace prefs active path, then the current session workspace.
   * Empty string means work without a project.
   * @param cwd Absolute workspace path, empty string for no project, or omit.
   */
  newSession: (cwd?: string) => Promise<void>;
  /**
   * Switch the empty draft's workspace (and default for New chat).
   * Locked when the open session already has user/agent messages — call
   * New chat first to switch projects after chatting.
   * @param cwd Absolute path, or empty/null for no project.
   * @returns ok, or `{ ok: false, reason: "locked" }` when content exists.
   */
  setWorkspace: (cwd: string | null) => Promise<SetWorkspaceResult>;
  reconnect: () => Promise<void>;
  /**
   * Auto-retry path: open the bridge WebSocket when down, resume the viewing
   * session if one exists, otherwise connect only (no session/new).
   * No-op while connecting or already live.
   */
  ensureConnected: () => Promise<void>;
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
  /**
   * Persist a user-chosen rail title and lock it against agent / timeline overwrite.
   * Empty or whitespace-only titles are ignored (the rail cancels instead).
   * @param id Catalog session id.
   * @param title Proposed display title; the action trims and clips it.
   */
  renameSession: (id: string, title: string) => void;
  /**
   * Send prompt text and optional multi-block content (images / resource_link).
   * @param text User text (also used for queue key).
   * @param blocks Optional ACP ContentBlocks; when set, bridge sends full prompt array.
   */
  sendPrompt: (text: string, blocks?: ContentBlock[]) => Promise<boolean>;
  cancelTurn: () => void;
  respondPermission: (optionId: string) => void;
  /**
   * Request a mode switch: sets pendingMode, calls bridge; does not claim success
   * until session.mode matches or the pending timeout settles optimistically.
   * @param mode Target agent mode.
   */
  setMode: (mode: AgentMode) => void;
  /** Clear pendingMode (timeout settle or external cancel). */
  clearPendingMode: () => void;
  /**
   * Select model: calls bridge session/set_model when live; optimistic local update.
   * On ACP unsupported, bridge emits restart_required (J-06).
   */
  setModel: (model: string) => void;
  /**
   * Prompts waiting while a turn streams (F-STREAM-09), each bound to a sessionId
   * so switching rails cannot drain another chat's queue into the wrong process.
   */
  promptQueue: PromptQueueItem[];
  enqueuePrompt: (text: string) => void;
  dequeuePrompt: () => string | null;
  clearPromptQueue: () => void;
  /**
   * Remove one follow-up by row id (Cancel, or Edit after the text is copied).
   * @param id {@link PromptQueueItem.id}; unknown ids are ignored.
   * @returns Removed text, or null when the row was already gone.
   */
  removeQueuedPrompt: (id: string) => string | null;
  /**
   * grok-build Send now: interrupt the live turn so this row drains next,
   * or send immediately when the canvas is already idle.
   * @param id {@link PromptQueueItem.id}; unknown ids are ignored.
   */
  sendQueuedPromptNow: (id: string) => void;
  /** Last SPAWN restart notice for UI banner (J-06). */
  restartNotice: string | null;
  clearRestartNotice: () => void;
  /** Run one-shot CLI channel via live bridge. */
  runCli: (
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /**
   * Pull upstream sessions from all workspaces into the rail catalog.
   * Empty remote leaves local rows intact; requires live-bridge.
   */
  syncRemoteSessions: () => Promise<{
    ok: boolean;
    count: number;
    error?: string;
  }>;
  /**
   * Fork the open session into a peer. Paints the centered restore empty
   * state for at least 1s, then switches the canvas to `newSessionId`.
   * @param opts Optional child workspace (worktree path); default = parent cwd.
   */
  forkSession: (opts?: {
    newCwd?: string;
  }) => Promise<{ ok: true; newSessionId: string } | { ok: false; error: string }>;
  /** Restart session process with new SPAWN config + session/load. */
  restartWithSpawn: (spawnConfig: Record<string, unknown>) => boolean;
  disconnect: () => void;
  hydrateCatalog: () => void;
  refreshEnvironment: () => void;
  /**
   * Ask the bridge for login state only (`check_auth`). Cheap enough for the
   * 3s poll; the answer arrives asynchronously on `authed`. No-op when the
   * bridge socket is down — the reconnect loop owns that case.
   */
  refreshAuth: () => void;
  /**
   * Run `grok login` (opens the browser) and re-probe as soon as it returns.
   * The CLI can outlive the client's request timeout, which is exactly why
   * the 3s poll exists — this only shortens the happy path.
   * @returns True when the CLI exited cleanly and a credential now exists.
   */
  authLogin: () => Promise<boolean>;
  /**
   * Run `grok logout`, then re-probe. The bridge disposes every runtime in
   * the pool on success, so the open session is dead afterwards regardless of
   * what this resolves to.
   * @returns True when the CLI reported success.
   */
  authLogout: () => Promise<boolean>;
  /**
   * Pull weekly remaining from the live grok-build `x.ai/billing` extension.
   * No-op when disconnected, in-flight, or the agent does not expose billing.
   * Resolves with the pacing hint the composer poll uses to back off.
   */
  refreshWeeklyUsage: () => Promise<WeeklyUsageOutcome>;
};

/** Zustand set function used by action modules. */
export type SessionStoreSet = (
  partial:
    | Partial<SessionStore>
    | ((state: SessionStore) => Partial<SessionStore>),
) => void;

/** Zustand get function used by action modules. */
export type SessionStoreGet = () => SessionStore;
