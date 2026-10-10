/**
 * Remembered border-box heights for timeline rows, keyed by the same unit key
 * React uses for the row shell.
 *
 * `timeline-settled` shells carry `contain-intrinsic-block-size: auto 240px`;
 * the `auto` half remembers the last real size only while the element stays
 * mounted. A rail switch remounts every row, so each revisit fell back to the
 * cold 240px estimate and the first jump to bottom landed several viewports
 * short — the settle walk that flashed the canvas. Feeding the last measured
 * height back as the seed estimate makes the first jump land on (or near) the
 * real bottom; the stick-to-bottom observer covers late growth such as image
 * decode.
 *
 * Boundary: module-level cache shared by every mounted row; no React, no DOM.
 */

/** Max remembered rows before the oldest entries are evicted (LRU touch). */
export const TIMELINE_ROW_HEIGHT_CACHE_LIMIT = 400;

/** unitKey → last measured border-box height in CSS pixels. */
const heights = new Map<string, number>();

/**
 * Read the remembered height for a row shell, marking it recently used.
 * @param unitKey `timelineRenderUnitKey` of the row being mounted.
 * @returns Last measured px, or undefined when the row was never painted.
 */
export function rememberedTimelineRowHeight(
  unitKey: string,
): number | undefined {
  const hit = heights.get(unitKey);
  if (hit !== undefined) {
    // LRU touch: recently painted rows must outlive cold entries.
    heights.delete(unitKey);
    heights.set(unitKey, hit);
  }
  return hit;
}

/**
 * Record a measured row height. Values at or under 1px are ignored (a skipped
 * shell can report a degenerate box in test DOMs and must not poison the
 * estimate). Entries past {@link TIMELINE_ROW_HEIGHT_CACHE_LIMIT} evict the
 * least recently used key.
 * @param unitKey `timelineRenderUnitKey` of the measured row.
 * @param px Border-box height in CSS pixels.
 */
export function noteTimelineRowHeight(unitKey: string, px: number): void {
  if (!unitKey || !Number.isFinite(px) || px <= 1) {
    return;
  }
  heights.delete(unitKey);
  heights.set(unitKey, px);
  while (heights.size > TIMELINE_ROW_HEIGHT_CACHE_LIMIT) {
    const oldest = heights.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    heights.delete(oldest);
  }
}

/** Drop the whole cache — tests and a full store reset must not leak heights. */
export function forgetTimelineRowHeights(): void {
  heights.clear();
}
