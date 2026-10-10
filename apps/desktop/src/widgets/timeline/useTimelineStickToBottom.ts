/**
 * Stick-to-bottom for the chat timeline scroll container.
 * - Selecting any session re-pins and jumps to the latest messages (instant, no glide).
 * - While pinned, content growth (stream / new turns) keeps the viewport at bottom.
 * - User scroll away from bottom unpins until they return near the bottom (or switch session).
 *
 * Two content-visibility realities shape the implementation:
 * - Settled rows report their contain-intrinsic-block-size estimate until the
 *   rendered band reaches them, so a jump to "the bottom" lands short and the
 *   real bottom keeps drifting while the band resolves. Deferred paint
 *   (fences / math / images) grows rows later still. A ResizeObserver on the
 *   single inner content box (`.timeline-body`) repins inside the same frame's
 *   resize pass — before the displaced frame can paint — which replaced the
 *   old rAF settle loop that chased drift one frame late and quit after 90
 *   frames (a late image decode then visibly shook the canvas).
 * - Those short jumps fire scroll events with distance-to-bottom > threshold;
 *   distance alone must not detach the pin, so the handler only unpins on a
 *   real upward gesture — scrollTop below the last observed offset
 *   (stickAfterScroll).
 *
 * Boundary: owns only local scroll pin state; does not touch the session store.
 * scrollTop is intentional DOM scroll control (same exception as composer mirror sync).
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
  stickAfterScroll,
} from "@/lib/timelineScroll";

export type UseTimelineStickToBottomArgs = {
  /**
   * Viewing/active session id. Any change forces pin + scroll-to-bottom
   * (clicking a chat in the rail / overview always shows latest).
   */
  sessionId: string | null;
  /**
   * Cheap fingerprint of timeline content (length, last chunk size, status).
   * When it changes while pinned, the viewport follows the bottom.
   */
  contentKey: string;
};

export type UseTimelineStickToBottomResult = {
  /** Attach to the overflow-y timeline element. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Wire to onScroll; updates pin from proximity to bottom. */
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  /**
   * Programmatic jump to bottom and re-pin.
   * @param behavior Only `smooth` animates; anything else assigns scrollTop instantly
   *   so session switch / stream follow never inherit CSS scroll-behavior.
   */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
};

/**
 * Hook: pin/follow the timeline bottom across session switches and live updates.
 * @param args sessionId + contentKey; wrong/stale keys only affect follow timing, not safety.
 * @returns ref + scroll handler + imperative scrollToBottom for session switch / follow.
 */
export function useTimelineStickToBottom(
  args: UseTimelineStickToBottomArgs,
): UseTimelineStickToBottomResult {
  const { sessionId, contentKey } = args;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** true while the user is (or should be) following the latest messages. */
  const stickRef = useRef(true);
  /** Last session we pinned for; used to force re-pin on select. */
  const lastSessionRef = useRef<string | null>(sessionId);
  /**
   * scrollTop seen at the last programmatic write or scroll event. Gesture
   * detection compares the next event against it (see stickAfterScroll).
   */
  const lastTopRef = useRef(0);

  /**
   * Move the timeline flush to its content bottom.
   * Instant path writes scrollTop directly (does not go through scrollTo + CSS
   * scroll-behavior). Smooth is reserved for explicit UX jumps when needed.
   * @param behavior `smooth` animates; default / other values jump immediately.
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickRef.current = true;
    const top = scrollTopForBottom(el);
    lastTopRef.current = top;
    if (behavior === "smooth" && typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "smooth" });
      return;
    }
    // Direct assignment: no animation, no CSS scroll-behavior inheritance.
    el.scrollTop = top;
  }, []);

  /**
   * Update pin from user scroll position.
   * Direction-aware: our own short jumps (estimated bottoms) echo back as
   * scroll events that are still far from the bottom — distance alone would
   * detach the pin and kill the settle loop, so only a scrollTop decrease
   * below the last observed offset counts as the user scrolling up.
   * @param event scroll event from the timeline container; wrong target is ignored.
   */
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const top = el.scrollTop;
    stickRef.current = stickAfterScroll({
      wasStuck: stickRef.current,
      previousTop: lastTopRef.current,
      currentTop: top,
      nearBottom: isScrollNearBottom(el),
    });
    lastTopRef.current = top;
  }, []);

  useLayoutEffect(() => {
    const sessionChanged = lastSessionRef.current !== sessionId;
    if (sessionChanged) {
      lastSessionRef.current = sessionId;
      stickRef.current = true;
    }
    if (!stickRef.current) {
      return;
    }
    // Sync jump before browser paint so session switch opens on the latest
    // messages with no intermediate frame at the previous scroll offset.
    scrollToBottom("auto");
    /**
     * Re-pin whenever the measured content height changes. The scroller's own
     * border box never resizes, so the observer watches its single inner box
     * (`.timeline-body`; the `.empty` guide when there is no body). RO
     * notifications arrive after layout and before paint, so each repin lands
     * in the same frame that drifted — the user never sees the intermediate
     * offset. Guarded by stickRef so a user who scrolled up stays put.
     */
    const inner = scrollRef.current?.firstElementChild;
    if (!(inner instanceof Element) || typeof ResizeObserver !== "function") {
      return;
    }
    const repin = () => {
      if (stickRef.current) {
        scrollToBottom("auto");
      }
    };
    const ro = new ResizeObserver(repin);
    ro.observe(inner);
    // One post-bind pass: a row can still be mid-layout when the observer arms.
    const raf = window.requestAnimationFrame(repin);
    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [sessionId, contentKey, scrollToBottom]);

  return { scrollRef, handleScroll, scrollToBottom };
}
