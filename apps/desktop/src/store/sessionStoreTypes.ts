/**
 * Zustand session store shape and shared result types.
 * Implementation lives in sessionStore + action modules.
 */

import type {
  AgentMode,
  ContentBlock,
  SessionState,
} from "@grok-desktop/acp-core";
import type { EnvironmentInfo, PoolEntry } from "../bridge/liveBridge";
import type { SessionRecord } from "./sessionCatalog";
import type {
  ConnectionMode,
  LiveHandle,
} from "./sessionStoreLive";
import type { StartOpts } from "./sessionStoreSupport";
import type { PromptQueueItem } from "@/lib/promptQueue";

export type { ConnectionMode, EnvironmentInfo, PoolEntry };
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
  poolEntries: PoolEntry[];
  environment: EnvironmentInfo | null;
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
   * Set only when the seed timeline is empty (rows discovered by disk sync),
   * because session/load replay is silent until it finishes — without this the
   * canvas would show the New chat empty state and read as an empty session.
   * Cleared by the first inbound snapshot that carries content.
   */
  restoringSessionId: string | null;
  startLiveBridge: (opts?: StartOpts) => Promise<void>;
  /**
   * Open a local New chat draft (empty canvas, no bridge session/new).
   * The real session is created only when the user actually sends a message.
   * Optional `cwd` overrides the default project; when omitted, uses workspace
   * prefs active path, then the current session workspace. Empty string means
   * work without a project.
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
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
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
  /** Restart session process with new SPAWN config + session/load. */
  restartWithSpawn: (spawnConfig: Record<string, unknown>) => boolean;
  disconnect: () => void;
  hydrateCatalog: () => void;
  refreshEnvironment: () => void;
};

/** Zustand set function used by action modules. */
export type SessionStoreSet = (
  partial:
    | Partial<SessionStore>
    | ((state: SessionStore) => Partial<SessionStore>),
) => void;

/** Zustand get function used by action modules. */
export type SessionStoreGet = () => SessionStore;
