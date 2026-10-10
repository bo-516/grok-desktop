/**
 * Remembered-height binding for one settled timeline row.
 *
 * The view renders the returned `contain-intrinsic-block-size` seed on the row
 * shell (React-rendered style, never an imperative write); this hook only
 * reads the module cache and feeds measurements back into it.
 */

import { useLayoutEffect, type RefObject } from "react";
import {
  noteTimelineRowHeight,
  rememberedTimelineRowHeight,
} from "@/lib/timelineRowHeights";

export type UseTimelineRowHeightMemoryArgs = {
  /** Row identity — matches the React key / entrance-baseline key. */
  unitKey: string;
  /** Streaming rows are not content-visibility shells; memory is skipped. */
  live: boolean;
  /** Shell element the measurement is taken from. */
  shellRef: RefObject<HTMLDivElement | null>;
};

/**
 * Seed a remounted row's contain-intrinsic estimate with its last measured
 * height, and keep the cache fresh while the row stays mounted.
 * @param args Row key, live flag, and the shell ref the view renders.
 * @returns `contain-intrinsic-block-size` value when a height is remembered,
 *   undefined otherwise (the `timeline-settled` 240px default applies).
 */
export function useTimelineRowHeightMemory(
  args: UseTimelineRowHeightMemoryArgs,
): string | undefined {
  const { unitKey, live, shellRef } = args;
  /**
   * Looked up during render so the seed is on the very first paint of this
   * mounted instance. A lookup cannot change under one row's lifetime in a
   * way React must react to — later mounts simply read the newer value.
   */
  const remembered = live ? undefined : rememberedTimelineRowHeight(unitKey);

  useLayoutEffect(() => {
    const node = shellRef.current;
    if (live || !node || typeof ResizeObserver !== "function") {
      return;
    }
    /**
     * A skipped content-visibility box reports its intrinsic estimate — the
     * value just seeded — so recording it is a self-consistent no-op and the
     * cache cannot be poisoned by rows measured while off-screen.
     */
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const borderBox = entry.borderBoxSize?.[0]?.blockSize;
      const measured =
        typeof borderBox === "number" ? borderBox : entry.contentRect.height;
      noteTimelineRowHeight(unitKey, measured);
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, [unitKey, live, shellRef]);

  return remembered != null ? `auto ${Math.round(remembered)}px` : undefined;
}
