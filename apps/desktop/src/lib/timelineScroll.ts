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

/**
 * scrollTop drop (px) still attributed to rounding rather than a real upward
 * gesture. Fractional scroll offsets and scroll-anchoring nudges stay under 1px.
 */
const SCROLL_UP_EPSILON_PX = 1;

/**
 * Pin state after a scroll event on a stick-to-bottom surface.
 *
 * Only a real upward gesture detaches: scrollTop below the last offset the
 * surface observed (user write or programmatic jump). An event whose offset
 * equals or exceeds the last one — while still short of the bottom — is our
 * own jump echo or content-visibility drift (estimated row heights swapping
 * for real ones), neither of which is a gesture, so the previous pin stands.
 * Near-bottom always (re)attaches, covering the user's scroll back down.
 *
 * @param args `wasStuck` is the pin going into the event; `previousTop` the
 *   offset from the last write/event; `currentTop` the event's scrollTop;
 *   `nearBottom` the {@link isScrollNearBottom} verdict for the event.
 * @returns Pin state going forward. A wrong `previousTop` degrades to the
 *   old distance-only rule — safe, just flakier under content-visibility.
 */
export function stickAfterScroll(args: {
  wasStuck: boolean;
  previousTop: number;
  currentTop: number;
  nearBottom: boolean;
}): boolean {
  const { wasStuck, previousTop, currentTop, nearBottom } = args;
  if (nearBottom) {
    return true;
  }
  if (currentTop < previousTop - SCROLL_UP_EPSILON_PX) {
    return false;
  }
  return wasStuck;
}

/** Consecutive on-bottom frames that end a settle run. */
export const TIMELINE_SETTLE_STABLE_FRAMES = 2;
/** Per-run frame budget (~1.5s at 60fps) so drift cannot spin the loop forever. */
export const TIMELINE_SETTLE_FRAME_BUDGET = 90;
/** |offset − target| (px) still read as "on the bottom" — sub-pixel slack. */
export const TIMELINE_SETTLE_EPSILON_PX = 1;

/** Loop counters carried across frames of one settle run. */
export type TimelineSettleState = {
  /** Consecutive frames already measured on the bottom. */
  stableFrames: number;
  /** Frames consumed by this run, including the current one. */
  elapsedFrames: number;
};

/** Start-of-run counters for a settle loop. */
export const INITIAL_TIMELINE_SETTLE_STATE: TimelineSettleState = {
  stableFrames: 0,
  elapsedFrames: 0,
};

/**
 * One frame of the post-pin settle loop.
 *
 * content-visibility rows resolve their intrinsic estimate to real heights a
 * viewport band at a time, and deferred paint (fences / math / images) lands
 * after the commit — so the measured bottom keeps drifting for several frames
 * after a session-switch jump. Re-pinning every frame while it drifts walks
 * the viewport down without a fixed pass count guessing how many are needed.
 *
 * @param prev Counters from the previous frame (INITIAL_* on frame one).
 * @param distanceToBottom scrollTopForBottom − scrollTop for this frame.
 * @returns `repin` when the bottom moved out from under the viewport, `done`
 *   once it held still for {@link TIMELINE_SETTLE_STABLE_FRAMES} frames or the
 *   frame budget ran out, plus the counters for the next frame.
 */
export function advanceTimelineSettle(
  prev: TimelineSettleState,
  distanceToBottom: number,
): TimelineSettleState & { repin: boolean; done: boolean } {
  const onBottom =
    Math.abs(distanceToBottom) <= TIMELINE_SETTLE_EPSILON_PX;
  const stableFrames = onBottom ? prev.stableFrames + 1 : 0;
  const elapsedFrames = prev.elapsedFrames + 1;
  return {
    repin: !onBottom,
    done:
      stableFrames >= TIMELINE_SETTLE_STABLE_FRAMES ||
      elapsedFrames >= TIMELINE_SETTLE_FRAME_BUDGET,
    stableFrames,
    elapsedFrames,
  };
}
