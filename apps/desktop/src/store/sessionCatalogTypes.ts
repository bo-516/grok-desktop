/**
 * Session catalog types and storage key.
 * Pure types — no React, no I/O.
 */

import type {
  AgentMode,
  BackgroundTaskCard,
  GoalSnapshot,
  PlanEntry,
  SessionStatus,
  SubagentCard,
  SessionTokenUsage,
  TimelineItem,
  ToolCallCard,
} from "@grok-desktop/acp-core";

/** One remembered conversation (live or historical cache). */
export type SessionRecord = {
  id: string;
  /** Absolute workspace path used as project key. */
  workspace: string;
  /**
   * Display title (first user prompt, agent session_info, or user rename).
   * When {@link titleLocked} is true this is the user-chosen name and must
   * not be replaced by timeline / session_info upserts.
   */
  title: string;
  /**
   * User renamed this chat from the rail. Live upserts, remote session
   * merge, and title rehydrate must keep `title` as typed. Absent / false
   * leaves the auto-namer in charge.
   */
  titleLocked?: boolean;
  mode: AgentMode;
  model: string;
  status: SessionStatus;
  createdAt: number;
  /**
   * Last user or agent message activity (epoch ms). Shown as relative time
   * on session rows and used as the default within-project rail order
   * (newest first), overridden by pin / user drag. Must not advance on
   * select / reconnect / session/load bulk hydrate — only on live message
   * activity (streaming tip, small append) or a newer agent
   * `session_info_update.updatedAt` when content is unchanged.
   */
  updatedAt: number;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard>;
  plan?: PlanEntry[];
  lastAgentText: string;
  /**
   * Upstream role from summary `session_kind` (e.g. subagent / subagent_resume).
   * Absent for ordinary user chats. Kept in catalog so drill-down by
   * childSessionId still resolves; rail render filters these rows.
   */
  sessionKind?: string;
  /** Parent chat id when this row is a harness-spawned subagent session. */
  parentSessionId?: string;
  /**
   * Chat started with "No project" selected. Sticky per row because the bridge
   * resolves an empty cwd to its own working directory: on disk the session
   * lives under that folder, so `sessions_list` would otherwise re-home the row
   * into a real project group on the next sync. Rail renders these in the
   * standalone {@link NO_PROJECT_KEY} section instead of a project folder.
   */
  noProject?: boolean;
  /**
   * Session-scoped orchestration snapshot for Agents rail after switch/refresh.
   * Card identity/status only — large `output` text is trimmed on persist.
   */
  subagents?: Record<string, SubagentCard>;
  /** subagentId → spawn toolCallId join keys (timeline ↔ Agents cards). */
  subagentLinks?: Record<string, string>;
  /** Background shell tasks for the Agents rail. */
  backgroundTasks?: Record<string, BackgroundTaskCard>;
  /**
   * Goal-mode snapshot when the parent was running an orchestrated goal.
   * Includes `lastEventDetail` when the worker published a wrap-up.
   */
  goal?: GoalSnapshot;
  /**
   * Last live occupancy + billed turn rollup for the composer context ring.
   * session/load replay often omits envelope `_meta.totalTokens` and
   * `turn_completed`; without this field a reopen paints 0% / 0 of N tokens.
   */
  tokenUsage?: SessionTokenUsage;
  /**
   * Catalog row schema version after provenance whitelist migration.
   * Missing / 1 = pre-whitelist (may contain untagged child ghosts).
   * 2 = current (roles/migration applied).
   */
  schemaVersion?: number;
};

/** Sessions grouped under one workspace folder. */
export type ProjectGroup = {
  /** Grouping key = workspace path. */
  workspace: string;
  /** Basename for header. */
  projectName: string;
  sessions: SessionRecord[];
};

/** Time-bucket label used by the Framer side-nav (Today / Yesterday / Earlier). */
export type TimeBucket = "today" | "yesterday" | "earlier";

/** One time-bucket group for the session rail. */
export type TimeGroup = {
  /** Bucket key. */
  bucket: TimeBucket;
  /** Display label (en-US). */
  label: string;
  /** Sessions in this bucket, newest first. */
  sessions: SessionRecord[];
};

/** localStorage key for the persisted catalog JSON array. */
export const SESSION_STORAGE_KEY = "grok-desktop.session-catalog.v1";

/**
 * Group / prefs key for chats that belong to no workspace folder.
 * Same string the rail prefs use for collapse, preview-expand, and drag order.
 */
export const NO_PROJECT_KEY = "(no project)";

export {
  cleanHarnessGoalTitle,
  displaySessionTitle,
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isHarnessGoalTitle,
  isWeakSessionTitle,
  pickSessionTitle,
  shortSessionId,
  titleFromSessionState,
} from "@grok-desktop/acp-core";
