/**
 * Pure geometry for "is this timeline row close enough to highlight?".
 *
 * The timeline scroller is not the window: a fence below the fold is still
 * inside the viewport's box, clipped by `.timeline`. Intersection is decided
 * against the scroller rect, expanded by {@link TIMELINE_CODE_HIGHLIGHT_MARGIN_PX}
 * so a row tokenizes just before it scrolls in. No DOM access — the hook
 * passes rects from `getBoundingClientRect`.
 */

/** Box edges in viewport CSS pixels (same space as getBoundingClientRect). */
export type TimelineHighlightRect = {
  /** Top edge. */
  top: number;
  /** Right edge. */
  right: number;
  /** Bottom edge. */
  bottom: number;
  /** Left edge. */
  left: number;
};

/**
 * How far outside the timeline scroller a row may sit and still tokenize.
 * About one short viewport of prefetch, so scrolling onto a code block does
 * not flash plain text for the whole Shiki load. Too small flashes; too
 * large tokenizes rows the user may never reach.
 */
export const TIMELINE_CODE_HIGHLIGHT_MARGIN_PX = 480;

/**
 * True when `node` overlaps `root` expanded by `marginPx` on every side.
 * A zero-size node sitting on the root's edge counts as near (it is in the
 * band). An off-screen row whose border box is the contain-intrinsic size
 * still has a real rect, so skipped content-visibility rows are judged by
 * that box rather than by their unrendered children.
 * @param node Row shell rect. Missing / NaN edges return false (stay plain).
 * @param root Timeline scroller rect. The viewport rect when the row is not
 *   mounted under `.timeline`.
 * @param marginPx Prefetch band in CSS pixels. Negative collapses the band
 *   and can skip a row that is actually visible — pass
 *   {@link TIMELINE_CODE_HIGHLIGHT_MARGIN_PX}.
 */
export function timelineRowNearScroller(
  node: TimelineHighlightRect,
  root: TimelineHighlightRect,
  marginPx: number,
): boolean {
  if (
    !Number.isFinite(node.top) ||
    !Number.isFinite(node.bottom) ||
    !Number.isFinite(root.top) ||
    !Number.isFinite(root.bottom)
  ) {
    return false;
  }
  const top = root.top - marginPx;
  const bottom = root.bottom + marginPx;
  const left = root.left - marginPx;
  const right = root.right + marginPx;
  return (
    node.bottom >= top &&
    node.top <= bottom &&
    node.right >= left &&
    node.left <= right
  );
}
