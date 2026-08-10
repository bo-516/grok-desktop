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
   * on session rows; rail list order uses title first-char ASCII + user drag
   * (not this field). Must not advance on select / reconnect alone — only
   * when conversation content changes or agent reports a newer
   * `session_info_update.updatedAt`.
   */
  updatedAt: number;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard>;
  plan?: PlanEntry[];
  lastAgentText: string;
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
