/**
 * Pure prompt-queue helpers (F-STREAM-09) — used by store and tests.
 * Queue items are scoped by sessionId so a drain on session B cannot
 * deliver text the user typed while session A was streaming.
 */

/** One queued prompt bound to the session that enqueued it. */
export type PromptQueueItem = {
  /** ACP session id at enqueue time (empty only if drafted without id — rare). */
  sessionId: string;
  /** Trimmed user text. */
  text: string;
};

/**
 * Enqueue a non-empty prompt for a specific session.
 * @param queue Existing queue.
 * @param sessionId Session that owns this prompt.
 * @param text Draft text.
 * @returns Next queue (same ref if empty text).
 */
export function enqueuePromptText(
  queue: PromptQueueItem[],
  sessionId: string,
  text: string,
): PromptQueueItem[] {
  const t = text.trim();
  if (!t) {
    return queue;
  }
  return [...queue, { sessionId, text: t }];
}

/**
 * Pop the first item that belongs to sessionId (or head when sessionId is empty match-any is not used).
 * @param queue Existing queue.
 * @param sessionId Session whose next item should be drained.
 * @returns head text for that session + rest of queue with that item removed.
 */
export function dequeuePromptForSession(
  queue: PromptQueueItem[],
  sessionId: string,
): { head: string | null; rest: PromptQueueItem[] } {
  if (!sessionId || queue.length === 0) {
    return { head: null, rest: queue };
  }
  const idx = queue.findIndex((item) => item.sessionId === sessionId);
  if (idx < 0) {
    return { head: null, rest: queue };
  }
  const head = queue[idx]?.text ?? null;
  const rest = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  return { head, rest };
}

/**
 * Count items for one session (composer / dock badge).
 * @param queue Full multi-session queue.
 * @param sessionId Active canvas session id.
 */
export function countQueueForSession(
  queue: PromptQueueItem[],
  sessionId: string,
): number {
  if (!sessionId) {
    return 0;
  }
  return queue.filter((item) => item.sessionId === sessionId).length;
}

/**
 * Drop every queued item for a session (select away / remove session).
 * @param queue Existing queue.
 * @param sessionId Session to clear.
 */
export function clearQueueForSession(
  queue: PromptQueueItem[],
  sessionId: string,
): PromptQueueItem[] {
  if (!sessionId) {
    return queue;
  }
  return queue.filter((item) => item.sessionId !== sessionId);
}

/**
 * Drop a queued item by index (user cancel).
 * @param queue Existing queue.
 * @param index 0-based index.
 */
export function removeQueuedAt(
  queue: PromptQueueItem[],
  index: number,
): PromptQueueItem[] {
  if (index < 0 || index >= queue.length) {
    return queue;
  }
  return queue.filter((_, i) => i !== index);
}

/**
 * @deprecated Prefer dequeuePromptForSession — kept for tests that used head-of-queue.
 * Pop head of queue regardless of session (legacy shape).
 */
export function dequeuePromptText(
  queue: PromptQueueItem[],
): { head: string | null; rest: PromptQueueItem[] } {
  if (queue.length === 0) {
    return { head: null, rest: queue };
  }
  const [first, ...rest] = queue;
  return { head: first?.text ?? null, rest };
}
