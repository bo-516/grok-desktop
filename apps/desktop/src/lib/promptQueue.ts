/**
 * Pure prompt-queue helpers (F-STREAM-09) — used by store and tests.
 * Queue items are scoped by sessionId so a drain on session B cannot
 * deliver text the user typed while session A was streaming.
 * Each item has a stable `id` so Send now / Edit / Cancel target one row
 * even when two follow-ups share the same text.
 */

/** One queued prompt bound to the session that enqueued it. */
export type PromptQueueItem = {
  /** Stable row id for composer actions; never reused within a process. */
  id: string;
  /** ACP session id at enqueue time (empty only if drafted without id — rare). */
  sessionId: string;
  /** Trimmed user text. */
  text: string;
};

/**
 * Result of deciding how Send now should treat one queued row.
 * `none` means the id is gone; `interrupt` reorders then cancels the turn;
 * `send` removes the row so the store can prompt immediately on an idle canvas.
 */
export type SendQueuedNowPlan =
  | { kind: "none" }
  | { kind: "interrupt"; queue: PromptQueueItem[] }
  | { kind: "send"; queue: PromptQueueItem[]; text: string };

/** Monotonic suffix so generated ids stay unique across rapid enqueues. */
let promptQueueSeq = 0;

/**
 * Allocate a new queue-row id.
 * @returns Process-unique id (`pq-<time>-<seq>`); not persisted across reloads.
 */
export function nextPromptQueueId(): string {
  promptQueueSeq += 1;
  return `pq-${Date.now().toString(36)}-${promptQueueSeq}`;
}

/**
 * Enqueue a non-empty prompt for a specific session.
 * @param queue Existing queue.
 * @param sessionId Session that owns this prompt.
 * @param text Draft text.
 * @param id Optional explicit row id (tests); omitted → {@link nextPromptQueueId}.
 * @returns Next queue (same ref if empty text).
 */
export function enqueuePromptText(
  queue: PromptQueueItem[],
  sessionId: string,
  text: string,
  id?: string,
): PromptQueueItem[] {
  const t = text.trim();
  if (!t) {
    return queue;
  }
  return [
    ...queue,
    { id: id && id.trim() ? id : nextPromptQueueId(), sessionId, text: t },
  ];
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

/**
 * Items belonging to one canvas session, in enqueue order.
 * @param queue Full multi-session queue.
 * @param sessionId Active canvas session id.
 * @returns Matching rows (empty when sessionId is blank).
 */
export function queueForSession(
  queue: PromptQueueItem[],
  sessionId: string,
): PromptQueueItem[] {
  if (!sessionId) {
    return [];
  }
  return queue.filter((item) => item.sessionId === sessionId);
}

/**
 * Remove one row by id (Edit / Cancel).
 * @param queue Existing queue.
 * @param id Row id from {@link PromptQueueItem.id}.
 * @returns Queue without that row (same ref when id is missing).
 */
export function removeQueuedById(
  queue: PromptQueueItem[],
  id: string,
): PromptQueueItem[] {
  if (!id) {
    return queue;
  }
  const next = queue.filter((item) => item.id !== id);
  return next.length === queue.length ? queue : next;
}

/**
 * Take one row by id and return it plus the remainder.
 * @param queue Existing queue.
 * @param id Row id to pull.
 * @returns The item (or null) and the queue without it.
 */
export function takeQueuedById(
  queue: PromptQueueItem[],
  id: string,
): { item: PromptQueueItem | null; rest: PromptQueueItem[] } {
  if (!id || queue.length === 0) {
    return { item: null, rest: queue };
  }
  const idx = queue.findIndex((item) => item.id === id);
  if (idx < 0) {
    return { item: null, rest: queue };
  }
  return {
    item: queue[idx] ?? null,
    rest: [...queue.slice(0, idx), ...queue.slice(idx + 1)],
  };
}

/**
 * Move one row to the front of its session so the idle drain sends it next.
 * Other sessions keep their relative order; siblings that were ahead of this
 * id slide behind it.
 * @param queue Existing queue.
 * @param id Row to prioritize.
 * @returns Reordered queue (same ref when id is missing).
 */
export function prioritizeQueuedById(
  queue: PromptQueueItem[],
  id: string,
): PromptQueueItem[] {
  const idx = queue.findIndex((item) => item.id === id);
  if (idx < 0) {
    return queue;
  }
  const item = queue[idx];
  if (!item) {
    return queue;
  }
  const without = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  const insertAt = without.findIndex((row) => row.sessionId === item.sessionId);
  if (insertAt < 0) {
    return [item, ...without];
  }
  return [...without.slice(0, insertAt), item, ...without.slice(insertAt)];
}

/**
 * Decide Send now: interrupt a busy turn (item stays queued, moved first)
 * or drop the row so the store can prompt on an idle canvas.
 * @param queue Existing queue.
 * @param id Row the user clicked.
 * @param turnBusy True while the canvas/pool turn is streaming or waiting.
 * @returns Plan for {@link sendQueuedNowAction}; `none` when the id is gone.
 */
export function planSendQueuedNow(
  queue: PromptQueueItem[],
  id: string,
  turnBusy: boolean,
): SendQueuedNowPlan {
  const item = queue.find((row) => row.id === id);
  if (!item) {
    return { kind: "none" };
  }
  if (turnBusy) {
    return { kind: "interrupt", queue: prioritizeQueuedById(queue, id) };
  }
  return {
    kind: "send",
    queue: removeQueuedById(queue, id),
    text: item.text,
  };
}
