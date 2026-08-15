/**
 * Follow-scroll for an expanded live thought body inside the capped turn-rail.
 * Writes only `scrollTop` on `[data-kind=turn-rail]` — never `scrollIntoView`,
 * which would also drag the outer timeline and fight stick-to-bottom.
 *
 * Aligns the thought tail to the rail fold (not the rail content bottom) so
 * later tool rows below the thought do not steal the follow. Pin starts true
 * while open+enabled. A chunk taller than the near-bottom threshold must not
 * unpin (that is growth, not a user scroll). Scrolling up to read earlier
 * reasoning unpins until the user returns near the tail.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  isEdgeNear,
  scrollDeltaToAlignBottoms,
} from "@/lib/timelineScroll";

export type UseFollowThoughtInRailArgs = {
  /** Whether the thought step is expanded. Closed rows have no body to follow. */
  open: boolean;
  /**
   * When false, never follows (completed / history thoughts). Expanding a
   * finished row must stay at the start so the user can read from the top.
   */
  enabled: boolean;
  /**
   * Growth fingerprint (usually thought text). Changes while open+enabled
   * trigger a follow tick. Missing / empty still runs so the first chunk lands.
   */
  contentKey: string;
  /** Ref attached to the expanded thought body (or group body wrapper). */
  bodyRef: RefObject<HTMLElement | null>;
};

/**
 * Keep an expanded live thought tail visible inside the nearest turn-rail.
 * @param args open + enabled + contentKey + bodyRef; missing rail / body is a no-op.
 */
export function useFollowThoughtInRail(args: UseFollowThoughtInRailArgs): void {
  const { open, enabled, contentKey, bodyRef } = args;
  /** true while the user is following this thought's tail. */
  const stickRef = useRef(true);

  useLayoutEffect(() => {
    if (!open || !enabled) {
      stickRef.current = true;
      return;
    }
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const rail = body.closest("[data-kind='turn-rail']");
    if (!(rail instanceof HTMLElement)) {
      return;
    }
    const onScroll = () => {
      const portRect = rail.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      stickRef.current = isEdgeNear(portRect.bottom, bodyRect.bottom);
    };
    // contentKey is a dep: the body is omitted until the first chunk, so this
    // listener rebinds once the element actually mounts.
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
    };
  }, [open, enabled, bodyRef, contentKey]);

  useLayoutEffect(() => {
    if (!open || !enabled || !stickRef.current) {
      return;
    }
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const rail = body.closest("[data-kind='turn-rail']");
    if (!(rail instanceof HTMLElement)) {
      return;
    }
    const portRect = rail.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const delta = scrollDeltaToAlignBottoms(portRect.bottom, bodyRect.bottom);
    if (delta === 0) {
      return;
    }
    rail.scrollTop = Math.max(0, rail.scrollTop + delta);
  }, [open, enabled, contentKey, bodyRef]);
}
