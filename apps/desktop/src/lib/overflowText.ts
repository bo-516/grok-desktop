/**
 * Overflow measurement + tip placement for truncated single-line labels.
 * Used by OverflowTextView: ellipsis in-row, full string in a preformatted
 * popup that hugs the cell's bottom-right (or top-right) corner.
 */

/** GitHub blob URL used as a long-path pretext when testing wrap / ellipsis. */
export const GITHUB_OVERFLOW_PRETEXT =
  "https://github.com/bo-516/grok-desktop/blob/main/apps/desktop/src/widgets/CommandPaletteWidget.tsx#L192-L214";

/** Subpixel slack so equal-width text is not treated as clipped. */
const OVERFLOW_SLACK_PX = 1;
/** Gap from the cell corner to the tip so the two stay visually attached. */
const TIP_GAP_PX = 4;
/** How far the tip overlaps the cell from the right (tucks under the truncated line). */
const CORNER_INSET_PX = 88;
/** Smallest readable tip width. */
const TIP_MIN_WIDTH_PX = 160;
/** Preferred tip width for a GitHub-length path. */
const TIP_PREFERRED_WIDTH_PX = 420;
/** Distance the tip must stay inside the viewport. */
const VIEW_PAD_PX = 12;
/** Flip the tip to the top-right once the anchor sits in this bottom fraction. */
const FLIP_FROM_BOTTOM = 0.72;

export type OverflowBox = {
  /** Viewport X of the box left edge. */
  left: number;
  /** Viewport Y of the box top edge. */
  top: number;
  /** Viewport X of the box right edge. */
  right: number;
  /** Viewport Y of the box bottom edge. */
  bottom: number;
  /** Layout width used when the tip should share the cell's column. */
  width: number;
};

export type OverflowViewport = {
  /** window.innerWidth */
  width: number;
  /** window.innerHeight */
  height: number;
};

export type OverflowTipBox = {
  /** fixed `top` when the tip sits below the cell; omitted when `bottom` is set. */
  top?: number;
  /** fixed `bottom` when the tip sits above the cell; omitted when `top` is set. */
  bottom?: number;
  /** fixed `left` — hangs from the cell's right edge, inset so it stays close. */
  left: number;
  /** max-width so a GitHub pretext wraps instead of escaping the viewport. */
  maxWidth: number;
  /** True when the tip sits above the cell (top-right). */
  above: boolean;
};

/**
 * Whether a single-line box is clipped on the X axis.
 * @param el Measured element (`scrollWidth` / `clientWidth`); 1px slack ignores subpixel noise.
 * @returns True when the text is visually truncated.
 */
export function isOverflowingX(el: {
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  return el.scrollWidth - el.clientWidth > OVERFLOW_SLACK_PX;
}

/**
 * Place a preformatted overflow tip at the cell's bottom-right, or top-right
 * when the cell sits near the viewport floor. The tip overlaps the right
 * of the cell so it stays close; width shrinks before the tip slides
 * left, so a wide viewport keeps the popup on the corner instead of drifting.
 * @param anchor Cell's getBoundingClientRect() box.
 * @param viewport Window size; width and left are clamped so the tip stays on screen.
 * @returns Layout numbers for React `style` (position only, no color).
 */
export function placeOverflowTip(
  anchor: OverflowBox,
  viewport: OverflowViewport,
): OverflowTipBox {
  const viewMax = Math.max(TIP_MIN_WIDTH_PX, viewport.width - VIEW_PAD_PX * 2);
  const maxRight = viewport.width - VIEW_PAD_PX;
  const cellWidth = Math.max(0, anchor.right - anchor.left);
  const inset = Math.min(CORNER_INSET_PX, cellWidth / 2);
  const above = anchor.bottom > viewport.height * FLIP_FROM_BOTTOM;
  let left = anchor.right - inset;
  let maxWidth = Math.min(TIP_PREFERRED_WIDTH_PX, viewMax, maxRight - left);
  if (maxWidth < TIP_MIN_WIDTH_PX) {
    maxWidth = Math.min(TIP_PREFERRED_WIDTH_PX, viewMax);
    left = Math.max(VIEW_PAD_PX, maxRight - maxWidth);
  }
  const top = above ? undefined : anchor.bottom + TIP_GAP_PX;
  const bottom = above
    ? Math.max(VIEW_PAD_PX, viewport.height - anchor.top + TIP_GAP_PX)
    : undefined;
  return { top, bottom, left, maxWidth, above };
}
