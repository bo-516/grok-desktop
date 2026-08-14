/**
 * Pure entrance-animation bookkeeping for the chat canvas.
 *
 * Every top-level render unit is wrapped in FadeContent, which mounts at
 * opacity 0 and transitions in. Unit keys come from ACP item ids and are
 * therefore session-scoped: switching sessions in the rail remounts the whole
 * list, so without a baseline the canvas blanks and re-reveals an already-read
 * conversation on every click.
 *
 * This module decides which units count as restored history (render instantly);
 * everything else keeps the entrance. No React, no DOM — the hook wrapper owns
 * the refs.
 */

/** Baseline carried between renders of the timeline canvas. */
export type TimelineEntranceBaseline = {
  /** Session the baseline was captured for; null before any focus. */
  sessionId: string | null;
  /** Unit keys to render without an entrance animation. */
  seededUnitKeys: ReadonlySet<string>;
  /**
   * True while a cold-opened session still owes its replayed transcript.
   * The next non-empty paint is adopted as history rather than as live content.
   */
  awaitingBody: boolean;
};

/** Baseline for a canvas that has not painted any session yet. */
export const EMPTY_TIMELINE_ENTRANCE_BASELINE: TimelineEntranceBaseline = {
  sessionId: null,
  seededUnitKeys: new Set<string>(),
  awaitingBody: false,
};

/**
 * Advance the baseline for one render of the canvas.
 *
 * Switching sessions re-captures whatever is already on screen (the cached
 * transcript seeded from the catalog), so restored history never animates. When
 * the session opens with nothing cached the store marks it as restoring; the
 * baseline then stays open until the transcript lands so that first body is
 * history too. A wholesale id rewrite on the same session (fork `session/load`
 * replacing parent-copied ids) is also treated as history. Incremental appends
 * still animate.
 *
 * @param prev Baseline from the previous render; pass
 *   {@link EMPTY_TIMELINE_ENTRANCE_BASELINE} on first render.
 * @param next Current session id, its unit keys in render order, and the
 *   store's uncached-session marker. A stale `sessionId` would animate restored
 *   history; an unstable one would suppress every entrance. A wrong
 *   `restoringSessionId` costs at most one fade and never hides content.
 * @returns Same object reference when nothing changed (so callers can keep a
 *   stable set identity), otherwise the updated baseline.
 */
export function advanceTimelineEntranceBaseline(
  prev: TimelineEntranceBaseline,
  next: {
    sessionId: string | null;
    unitKeys: string[];
    restoringSessionId: string | null;
  },
): TimelineEntranceBaseline {
  if (prev.sessionId !== next.sessionId) {
    return {
      sessionId: next.sessionId,
      seededUnitKeys: new Set(next.unitKeys),
      awaitingBody:
        next.unitKeys.length === 0 &&
        next.restoringSessionId === next.sessionId,
    };
  }
  if (prev.awaitingBody && next.unitKeys.length > 0) {
    return {
      sessionId: next.sessionId,
      seededUnitKeys: new Set(next.unitKeys),
      awaitingBody: false,
    };
  }
  // Fork (and some session/load hydrates) replace every item id in one paint.
  // Those rows are already-read history, not live arrivals — FadeContent would
  // otherwise slide the whole transcript (the page-shake after /fork).
  if (timelineKeysReplaced(prev.seededUnitKeys, next.unitKeys)) {
    return {
      sessionId: next.sessionId,
      seededUnitKeys: new Set(next.unitKeys),
      awaitingBody: false,
    };
  }
  return prev;
}

/**
 * True when `next` shares no keys with the previous baseline.
 * Empty prev (first paint / new chat) or empty next is not a replace.
 * @param prev Seeded keys from the last baseline.
 * @param next Current unit keys in render order.
 * @returns Whether the canvas just swapped its entire identity set.
 */
export function timelineKeysReplaced(
  prev: ReadonlySet<string>,
  next: string[],
): boolean {
  if (prev.size === 0 || next.length === 0) {
    return false;
  }
  for (const key of next) {
    if (prev.has(key)) {
      return false;
    }
  }
  return true;
}
