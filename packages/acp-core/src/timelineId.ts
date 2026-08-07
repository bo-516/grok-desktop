/**
 * Local timeline identifier generator.
 * IDs are only for stable React list rendering, not ACP-side persistent IDs; an empty prefix from the caller falls back to `t`.
 */

/** In-process incrementing sequence, combined with a timestamp to avoid list key collisions within the same millisecond. */
let sequence = 0;

/**
 * Generate a local ID for one timeline record.
 * @param prefix Record category prefix; empty string uses the default prefix `t`.
 * @returns String usable as a React key within the current browser process; must not be sent to the agent.
 */
export function nextTimelineId(prefix = "t"): string {
  const normalizedPrefix = prefix || "t";
  sequence += 1;
  return `${normalizedPrefix}_${sequence}_${Date.now().toString(36)}`;
}

/**
 * Reset the local sequence counter so isolated tests get a predictable order.
 * Calling this in production raises the risk of reusing timeline keys, so it must not be used at runtime.
 * @returns No return value.
 */
export function resetTimelineIdCounter(): void {
  sequence = 0;
}
