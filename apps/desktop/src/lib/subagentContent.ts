/**
 * Local-only subagent inspect content: four-level resolver + cycle order +
 * transcript presentation. Never resumes a process or calls session/load.
 */

import {
  createSessionState,
  type SessionState,
  type SubagentCard,
} from "@grok-desktop/acp-core";
import {
  formatLiveElapsed,
  groupSubagentsByRound,
  normalizeSubagentStatus,
} from "@/lib/agentCards";
import {
  recordToSessionState,
  type SessionRecord,
} from "@/store/sessionCatalog";

/**
 * Renderable child transcript. All four kinds are client-local.
 *  1) live     — childSessions (or pendingSessions) buffer
 *  2) cached   — catalog snapshot
 *  3) outputOnly — card.output from subagent_finished
 *  4) unavailable — nothing recorded
 */
export type SubagentContent =
  | { kind: "live"; state: SessionState }
  | { kind: "cached"; state: SessionState }
  | { kind: "outputOnly"; text: string }
  | { kind: "unavailable" };

/** Read-only sources the resolver walks in priority order. */
export type SubagentContentSources = {
  /** Live child buffers keyed by child session id (this-turn fan-out). */
  childSessions: Record<string, SessionState>;
  /** Isolated buffers for frames that arrived before spawn (round-2). */
  pendingSessions: Record<string, SessionState>;
  /** Catalog rows; used as the cross-refresh snapshot. */
  catalog: SessionRecord[];
};

/**
 * True when a snapshot has any transcript the canvas can paint.
 * @param state Session snapshot; missing/empty timeline is not a transcript.
 */
export function sessionHasTranscript(state: SessionState | undefined): boolean {
  if (!state) {
    return false;
  }
  if (state.timeline.length > 0) {
    return true;
  }
  return Boolean(state.lastAgentText?.trim());
}

/**
 * Resolve the inspectable body for one child. Pure; no I/O.
 * Live buffer beats pending (also live) beats catalog beats card.output.
 * Empty sources → unavailable (UI must show an explicit empty state).
 * @param childSessionId Target child ACP session id.
 * @param sources Four local maps/lists; missing keys just miss that level.
 * @param card Orchestration card (output fallback + running/failed).
 */
export function resolveSubagentContent(
  childSessionId: string,
  sources: SubagentContentSources,
  card: SubagentCard | undefined,
): SubagentContent {
  const id = childSessionId.trim();
  if (!id) {
    return { kind: "unavailable" };
  }
  const live = sources.childSessions[id];
  if (live) {
    return { kind: "live", state: live };
  }
  const pending = sources.pendingSessions[id];
  if (pending) {
    return { kind: "live", state: pending };
  }
  const row = sources.catalog.find((r) => r.id === id);
  if (row && (row.timeline?.length || row.lastAgentText?.trim())) {
    return { kind: "cached", state: recordToSessionState(row) };
  }
  const output = card?.output?.trim();
  if (output) {
    return { kind: "outputOnly", text: card?.output ?? output };
  }
  return { kind: "unavailable" };
}

/**
 * Flatten `groupSubagentsByRound` into child session ids (round, then spawn).
 * Same order as the Agents roster and the L1 group — cycle keys use this.
 * @param subagents SessionState.subagents map, or undefined when none yet.
 * @returns Ordered child session ids; empty cards / blank ids are skipped.
 */
export function orderedSubagentSessionIds(
  subagents: Record<string, SubagentCard> | undefined,
): string[] {
  const ids: string[] = [];
  for (const round of groupSubagentsByRound(subagents)) {
    for (const card of round.cards) {
      const id = card.childSessionId?.trim();
      if (id) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Explicit non-blank body the Agents detail pane can paint. */
export type SubagentTranscriptPresentation =
  | {
      kind: "timeline";
      source: "live" | "cached";
      state: SessionState;
      /** True when this is a finished catalog snapshot (header shows Ended). */
      ended: boolean;
      /** Failed-card error bar; omit when the card is not failed. */
      error?: string;
    }
  | {
      kind: "outputOnly";
      text: string;
      error?: string;
    }
  | {
      kind: "unavailable";
      /** User-facing explanation; never an empty string. */
      message: string;
      error?: string;
    }
  | {
      kind: "pending";
      /** Live elapsed for a just-spawned running card, or empty. */
      elapsed: string;
    };

const UNAVAILABLE_MESSAGE =
  "This subagent's process was not recorded.";
const FAILED_MESSAGE = "This subagent failed.";

/**
 * Map a resolver result + card status onto an explicit detail-body variant.
 * Running + no transcript → pending skeleton; failed always carries an error.
 * @param args Content, optional card, and optional live clock.
 */
export function resolveSubagentTranscriptPresentation(args: {
  content: SubagentContent;
  card: SubagentCard | undefined;
  startedAtMs?: number;
  nowMs?: number;
}): SubagentTranscriptPresentation {
  const { content, card, startedAtMs, nowMs } = args;
  const status = normalizeSubagentStatus(card?.status);
  const failed = status === "failed";
  const error = failed ? FAILED_MESSAGE : undefined;

  if (content.kind === "live" || content.kind === "cached") {
    if (sessionHasTranscript(content.state)) {
      return {
        kind: "timeline",
        source: content.kind,
        state: content.state,
        ended: content.kind === "cached" || status === "completed",
        error,
      };
    }
    if (status === "running") {
      return {
        kind: "pending",
        elapsed: formatLiveElapsed(startedAtMs, nowMs),
      };
    }
    if (card?.output?.trim()) {
      return { kind: "outputOnly", text: card.output, error };
    }
    return { kind: "unavailable", message: UNAVAILABLE_MESSAGE, error };
  }

  if (content.kind === "outputOnly") {
    return { kind: "outputOnly", text: content.text, error };
  }

  if (status === "running") {
    return {
      kind: "pending",
      elapsed: formatLiveElapsed(startedAtMs, nowMs),
    };
  }
  return { kind: "unavailable", message: UNAVAILABLE_MESSAGE, error };
}

/**
 * Minimal idle snapshot used when a test or stub needs a SessionState shell.
 * @param id Session id to stamp.
 * @returns Empty idle session (no transcript).
 */
export function emptyInspectSession(id: string): SessionState {
  return createSessionState({ id, workspace: "" });
}
