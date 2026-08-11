/**
 * Session catalog types and storage key.
 * Pure types — no React, no I/O.
 */

import type {
  AgentMode,
  PlanEntry,
  SessionStatus,
  TimelineItem,
  ToolCallCard,
} from "@grok-desktop/acp-core";

/** One remembered conversation (live or historical cache). */
export type SessionRecord = {
  id: string;
  /** Absolute workspace path used as project key. */
  workspace: string;
  /** Display title (first user prompt or fallback). */
  title: string;
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

export {
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isWeakSessionTitle,
  pickSessionTitle,
  titleFromSessionState,
} from "@grok-desktop/acp-core";
