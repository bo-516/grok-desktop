/**
 * Stick-to-bottom for the capped turn activity rail (`.turn-rail`).
 * Live rails follow thought / tool growth so an expanded Working body
 * does not leave new steps below the fold. History rails stay at top.
 *
 * Observes the first child (`.turn-rail-body`) because the rail itself is
 * height-capped — its border box does not change once max-height hits, so a
 * ResizeObserver on the port would miss streaming thought text.
 *
 * Pin / unpin uses the same near-bottom threshold as the timeline.
 * scrollTop writes are intentional DOM scroll control (same exception as
 * useTimelineStickToBottom).
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
  type UIEvent,
} from "react";
import {
  isScrollNearBottom,
  scrollTopForBottom,
  shouldRepinOnEnable,
} from "@/lib/timelineScroll";

export type UseTurnRailStickToBottomArgs = {
  /**
   * When false, never programmatically scrolls (finished / compact rails).
   * Wrong true on a history rail jumps that rail to its tail on expand.
   */
  enabled: boolean;
  /**
   * Changes when rail children are added or removed so the observer rebinds
   * after a structural remount. Thought text growth is tracked via ResizeObserver.
   */
  structureKey: string | number;
};

export type UseTurnRailStickToBottomResult = {
  /** Attach to the overflow-y `.turn-rail` element. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Wire to onScroll; updates pin from proximity to the rail bottom. */
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
};

/**
 * Hook: pin/follow the turn-rail bottom while a live Working body grows.
 * @param args enabled gates all writes; structureKey only rebinds the observer.
 * @returns ref + scroll handler. Missing port is a silent no-op.
 */
export function useTurnRailStickToBottom(
  args: UseTurnRailStickToBottomArgs,
): UseTurnRailStickToBottomResult {
  const { enabled, structureKey } = args;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** true while the user is (or should be) following the latest rail step. */
  const stickRef = useRef(true);
  /** Previous `enabled` so we only force-pin on the false→true edge. */
  const wasEnabledRef = useRef(false);

  /**
   * Move the rail flush to its content bottom (does not force-pin).
   * Instant assignment only — never inherit CSS scroll-behavior.
   */
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = scrollTopForBottom(el);
  }, []);

  /**
   * Update pin from user scroll position inside the rail.
   * @param event scroll event from `.turn-rail`; wrong target is ignored.
   */
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    stickRef.current = isScrollNearBottom(event.currentTarget);
  }, []);

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      return;
    }
    const port = scrollRef.current;
    const inner = port?.firstElementChild;
    if (!port || !(inner instanceof Element)) {
      return;
    }
    // Re-pin only when a live rail first becomes eligible — a new tool must
    // not yank someone who scrolled up to read an earlier thought.
    if (shouldRepinOnEnable(wasEnabledRef.current, true)) {
      stickRef.current = true;
    }
    wasEnabledRef.current = true;
    const follow = () => {
      if (stickRef.current) {
        scrollToBottom();
      }
    };
    follow();
    const ro = new ResizeObserver(follow);
    ro.observe(inner);
    // One rAF: thought / tool cards may still grow after this layout.
    const raf = window.requestAnimationFrame(follow);
    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [enabled, structureKey, scrollToBottom]);

  return { scrollRef, handleScroll };
}
