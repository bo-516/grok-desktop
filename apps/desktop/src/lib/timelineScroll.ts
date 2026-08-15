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

/**
 * Whether a follow-scroll surface should force-pin on this enable edge.
 * Used by the turn-rail so a new thought/tool does not re-pin someone who
 * scrolled up, while a live rail that just opened still starts on the tail.
 * @param wasEnabled Previous frame's follow flag.
 * @param enabled Current follow flag.
 * @returns true only on the false→true edge.
 */
export function shouldRepinOnEnable(
  wasEnabled: boolean,
  enabled: boolean,
): boolean {
  return enabled && !wasEnabled;
}

/**
 * Whether two viewport edges are close enough to count as still pinned.
 * Used to follow a thought tail (not the whole rail) so later tool rows
 * below the thought do not steal the pin.
 * @param portBottom Viewport bottom of the overflow container.
 * @param itemBottom Viewport bottom of the followed element.
 * @param thresholdPx Absolute slack; negatives clamp to 0.
 * @returns true when |portBottom - itemBottom| ≤ threshold.
 */
export function isEdgeNear(
  portBottom: number,
  itemBottom: number,
  thresholdPx: number = TIMELINE_STICK_THRESHOLD_PX,
): boolean {
  const threshold = Math.max(0, thresholdPx);
  return Math.abs(portBottom - itemBottom) <= threshold;
}

/**
 * scrollTop delta that places `itemBottom` on `portBottom`.
 * Positive scrolls down (tail grew past the fold); negative scrolls up.
 * @param portBottom Viewport bottom of the overflow container.
 * @param itemBottom Viewport bottom of the followed element.
 * @returns Signed delta to add to the port's current scrollTop.
 */
export function scrollDeltaToAlignBottoms(
  portBottom: number,
  itemBottom: number,
): number {
  return itemBottom - portBottom;
}
