/**
 * Latch code-highlight visibility for one timeline row.
 *
 * The live turn is always `near` (it is the row stick-to-bottom keeps on
 * screen, and waiting on an observer would delay the streaming fence).
 * A settled row measures itself against `.timeline` and stays `deferred`
 * until it enters the prefetch band, then latches `near` so scrolling away
 * does not strip tokens that already arrived.
 *
 * Reads layout only. The class / context value is returned for React to
 * render — this hook does not write style or className onto the node.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CodeHighlightVisibility } from "@/widgets/shared";
import {
  TIMELINE_CODE_HIGHLIGHT_MARGIN_PX,
  timelineRowNearScroller,
} from "./timelineRowHighlight";

export type TimelineRowHighlight = {
  /**
   * Attach to the row shell. The shell is the content-visibility box, so
   * its border rect exists even while its children are skipped.
   */
  shellRef: RefObject<HTMLDivElement | null>;
  /** Mode for {@link CodeHighlightVisibilityProvider}. */
  visibility: CodeHighlightVisibility;
};

/**
 * Read a viewport rect, or null when the node cannot report one (SSR / a
 * test document with no layout). Null keeps the row deferred rather than
 * highlighting every fence.
 * @param node Element to measure.
 */
function readRect(node: HTMLElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} | null {
  if (typeof node.getBoundingClientRect !== "function") {
    return null;
  }
  const rect = node.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

/**
 * Decide whether fences inside this row should tokenize.
 * @param live True for the streaming turn. A wrong true highlights a
 *   settled row early; a wrong false waits until the row is near the scroller.
 * @returns A ref for the row shell and the current visibility mode.
 */
export function useTimelineRowHighlight(live: boolean): TimelineRowHighlight {
  const shellRef = useRef<HTMLDivElement | null>(null);
  /**
   * Latched mode. Live rows start near so the first streaming paint does not
   * wait a frame. Settled rows start deferred until layout says otherwise.
   */
  const [visibility, setVisibility] = useState<CodeHighlightVisibility>(
    live ? "near" : "deferred",
  );
  /**
   * Latest mode for the layout effect. A same-value setState still enqueues
   * an update React replays on the next props change, which paints the live
   * row twice on the first streamed chunk. Skip the call when already near.
   */
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;

  useLayoutEffect(() => {
    /**
     * Latch near once. Skipping a same-value setState matters: React still
     * enqueues it, then replays that update on the next props change and the
     * row paints twice.
     */
    const latchNear = (): void => {
      if (visibilityRef.current !== "near") {
        setVisibility("near");
      }
    };

    if (live) {
      latchNear();
      return;
    }
    const node = shellRef.current;
    if (node == null) {
      return;
    }
    /** Timeline scroller, if this row is mounted inside one. */
    const scroller = node.closest(".timeline");
    const nodeRect = readRect(node);
    const rootNode = scroller instanceof HTMLElement ? scroller : null;
    const rootRect = rootNode != null ? readRect(rootNode) : null;
    if (
      nodeRect != null &&
      rootRect != null &&
      timelineRowNearScroller(
        nodeRect,
        rootRect,
        TIMELINE_CODE_HIGHLIGHT_MARGIN_PX,
      )
    ) {
      latchNear();
      return;
    }
    if (typeof IntersectionObserver !== "function") {
      // No observer (older webview): keep today's eager highlight.
      latchNear();
      return;
    }
    const observedRoot = rootNode;
    /**
     * The callback's second argument is this observer, so the latch can
     * disconnect without closing over the const before it is initialized.
     */
    const observer = new IntersectionObserver(
      (entries, current) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (!hit) {
          return;
        }
        latchNear();
        current.disconnect();
      },
      {
        root: observedRoot,
        rootMargin: `${TIMELINE_CODE_HIGHLIGHT_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [live]);

  return { shellRef, visibility };
}
