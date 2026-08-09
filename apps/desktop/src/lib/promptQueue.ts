/**
 * Pure prompt-queue helpers (F-STREAM-09) — used by store and tests.
 */

/**
 * Enqueue a non-empty prompt.
 * @param queue Existing queue.
 * @param text Draft text.
 * @returns Next queue (same ref if empty text).
 */
export function enqueuePromptText(queue: string[], text: string): string[] {
  const t = text.trim();
  if (!t) {
    return queue;
  }
  return [...queue, t];
}

/**
 * Pop head of queue.
 * @param queue Existing queue.
 * @returns head + rest.
 */
export function dequeuePromptText(
  queue: string[],
): { head: string | null; rest: string[] } {
  if (queue.length === 0) {
    return { head: null, rest: queue };
  }
  const [head, ...rest] = queue;
  return { head: head ?? null, rest };
}

/**
 * Drop a queued item by index (user cancel).
 * @param queue Existing queue.
 * @param index 0-based index.
 */
export function removeQueuedAt(queue: string[], index: number): string[] {
  if (index < 0 || index >= queue.length) {
    return queue;
  }
  return queue.filter((_, i) => i !== index);
}
