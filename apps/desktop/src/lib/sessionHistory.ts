/**
 * Turn a disk `session_history` payload into SessionState for a cold open.
 * chat_history.jsonl is preferred (complete turns). updates.jsonl is the
 * fallback ACP log when chat history is missing.
 */

import {
  createSessionState,
  tagSeedUserMessages,
  type SessionState,
  type SessionUpdate,
} from "@grok-desktop/acp-core";
import {
  createSessionReduceBucket,
  reduceSessionUpdate,
} from "./sessionReduce";
import {
  sessionStateFromChatHistory,
  type SessionHistoryIdentity,
} from "./sessionHistoryChat";

export {
  DISK_TOOL_RESULT_MAX,
  displayUserText,
  isHarnessContextDump,
  sessionStateFromChatHistory,
  type SessionHistoryIdentity,
} from "./sessionHistoryChat";

/** One ACP update from the bridge `session_history` payload. */
export type SessionHistoryUpdateItem = {
  /** Discriminated sessionUpdate object. */
  update: SessionUpdate;
  /** Optional wire eventId for reduce dedupe. */
  eventId?: string;
};

/**
 * Normalized `session_history` CLI payload.
 * Wrong/missing fields become empty arrays so the caller can fall through
 * to session/load instead of throwing.
 */
export type SessionHistoryPayload = {
  sessionId: string;
  cwd: string;
  chatHistory: unknown[];
  updates: SessionHistoryUpdateItem[];
};

/**
 * Parse the free-form CLI `data` bag from `session_history`.
 * @param data Unknown cli_result.data; null/wrong shape → empty payload.
 * @returns Arrays safe to feed {@link sessionStateFromHistoryPayload}.
 */
export function parseSessionHistoryPayload(
  data: unknown,
): SessionHistoryPayload {
  if (!data || typeof data !== "object") {
    return { sessionId: "", cwd: "", chatHistory: [], updates: [] };
  }
  const rec = data as Record<string, unknown>;
  const sessionId = String(rec.sessionId ?? "").trim();
  const cwd = String(rec.cwd ?? "").trim();
  const chatHistory = Array.isArray(rec.chatHistory) ? rec.chatHistory : [];
  const updates: SessionHistoryUpdateItem[] = [];
  if (Array.isArray(rec.updates)) {
    for (const item of rec.updates) {
      const parsed = parseUpdateItem(item);
      if (parsed) {
        updates.push(parsed);
      }
    }
  }
  return { sessionId, cwd, chatHistory, updates };
}

/**
 * Build a seed SessionState from a history payload.
 * Prefers chat_history when it yields user/agent rows; otherwise reduces
 * ACP updates. Always tags rows as seed so a later session/load claims them.
 * @param payload Parsed CLI data.
 * @param identity Session id / workspace / catalog chrome to stamp.
 * @returns Idle snapshot; timeline may still be empty when both sources fail.
 */
export function sessionStateFromHistoryPayload(
  payload: SessionHistoryPayload,
  identity: SessionHistoryIdentity,
): SessionState {
  const fromChat = sessionStateFromChatHistory(payload.chatHistory, identity);
  if (fromChat.timeline.some((item) => item.kind === "user" || item.kind === "agent")) {
    return fromChat;
  }
  if (payload.updates.length > 0) {
    return sessionStateFromUpdates(payload.updates, identity);
  }
  return fromChat;
}

/**
 * Reduce ACP updates.jsonl items into a seed SessionState.
 * @param updates Ordered session/update items.
 * @param identity Session chrome.
 * @returns Idle snapshot (streaming residue from the last turn is cleared).
 */
export function sessionStateFromUpdates(
  updates: SessionHistoryUpdateItem[],
  identity: SessionHistoryIdentity,
): SessionState {
  const seed = createSessionState({
    id: identity.sessionId,
    workspace: identity.workspace,
    model: identity.model,
    mode: identity.mode,
  });
  if (identity.title?.trim()) {
    seed.title = identity.title.trim();
  }
  const bucket = createSessionReduceBucket(seed);
  for (const item of updates) {
    reduceSessionUpdate(bucket, item.update, item.eventId);
  }
  const next = bucket.state;
  next.timeline = tagSeedUserMessages(next.timeline ?? []);
  next.status = next.status === "waiting_permission" ? next.status : "idle";
  return next;
}

/**
 * Normalize one `updates[]` element from the CLI payload.
 * @param item Unknown array element.
 */
function parseUpdateItem(item: unknown): SessionHistoryUpdateItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const rec = item as Record<string, unknown>;
  let update: SessionUpdate | null = null;
  if (rec.update && typeof rec.update === "object") {
    update = rec.update as SessionUpdate;
  } else if (rec.sessionUpdate) {
    update = rec as SessionUpdate;
  }
  if (
    !update ||
    typeof (update as { sessionUpdate?: unknown }).sessionUpdate !== "string"
  ) {
    return null;
  }
  const eventId =
    typeof rec.eventId === "string" && rec.eventId.trim()
      ? rec.eventId.trim()
      : undefined;
  return eventId ? { update, eventId } : { update };
}
