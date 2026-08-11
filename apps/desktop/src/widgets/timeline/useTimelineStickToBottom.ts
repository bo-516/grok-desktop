/**
 * Stick-to-bottom for the chat timeline scroll container.
 * - Selecting any session re-pins and jumps to the latest messages (instant, no glide).
 * - While pinned, content growth (stream / new turns) keeps the viewport at bottom.
 * - User scroll away from bottom unpins until they return near the bottom (or switch session).
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
    if (behavior === "smooth" && typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "smooth" });
      return;
    }
    // Direct assignment: no animation, no CSS scroll-behavior inheritance.
    el.scrollTop = top;
  }, []);

  /**
   * Update pin from user scroll position.
   * @param event scroll event from the timeline container; wrong target is ignored.
   */
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    stickRef.current = isScrollNearBottom(el);
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
    // One rAF: markdown / tool cards may still grow height after first layout.
    const raf = window.requestAnimationFrame(() => {
      if (stickRef.current) {
        scrollToBottom("auto");
      }
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [sessionId, contentKey, scrollToBottom]);

  return { scrollRef, handleScroll, scrollToBottom };
}
