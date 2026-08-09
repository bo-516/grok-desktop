/**
 * Timeline stick-to-bottom helpers (TC-TM-08 / design TimelineWidget).
 * Pure metrics only — no DOM mutation; callers apply scrollTop / scrollTo.
 */

/** Distance from the bottom (px) still treated as “pinned” for follow-scroll. */
export const TIMELINE_STICK_THRESHOLD_PX = 80;

/**
 * Whether a scroll container is at or near its bottom edge.
 * @param el Scroll metrics; null/undefined → false (cannot decide).
 * @param thresholdPx Max remaining distance-to-bottom that still counts as pinned.
 *   Negative values are treated as 0. Missing uses {@link TIMELINE_STICK_THRESHOLD_PX}.
 * @returns true when content fits in the viewport or distance-to-bottom ≤ threshold.
 */
export function isScrollNearBottom(
  el:
    | Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">
    | null
    | undefined,
  thresholdPx: number = TIMELINE_STICK_THRESHOLD_PX,
): boolean {
  if (!el) {
    return false;
  }
  const threshold = Math.max(0, thresholdPx);
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance <= threshold;
}

/**
 * scrollTop value that places the container flush with the bottom of its content.
 * @param el Height metrics; null/undefined → 0.
 * @returns Non-negative max scroll offset (0 when content is shorter than the viewport).
 */
export function scrollTopForBottom(
  el: Pick<HTMLElement, "scrollHeight" | "clientHeight"> | null | undefined,
): number {
  if (!el) {
    return 0;
  }
  return Math.max(0, el.scrollHeight - el.clientHeight);
}
