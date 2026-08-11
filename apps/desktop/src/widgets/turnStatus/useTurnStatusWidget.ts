/**
 * Unified entry hook for the live-turn status strip.
 * Owns the once-a-second elapsed ticker (kept out of the composer so typing
 * never re-renders on the clock) and reads the session slices the strip needs.
 */

import { useEffect, useMemo, useState } from "react";
import { formatWorkedDuration } from "@/lib/turnLabel";
import { useSessionStore } from "@/store/sessionStore";
import { resolveTurnStatus, turnStartedAtMs } from "./turnStatusModel";

/** Clock resolution; the strip only ever shows whole seconds. */
const TICK_MS = 1000;

/**
 * Live strip state for the session on screen.
 * @returns `line` is null whenever the strip must stay unmounted (idle,
 *   awaiting permission, disconnected); `elapsedLabel` is only meaningful
 *   while a line exists.
 */
export function useTurnStatusWidget() {
  const status = useSessionStore((s) => s.session.status);
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const workspace = useSessionStore((s) => s.session.workspace);
  const streaming = status === "streaming";
  /** Wall clock, advanced by the ticker; frozen while the turn is not live. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** When this client first observed the live turn (reconnect-safe fallback). */
  const [seenAtMs, setSeenAtMs] = useState<number | null>(null);
  const line = useMemo(
    () => resolveTurnStatus({ status, timeline, toolCalls, workspace }),
    [status, timeline, toolCalls, workspace],
  );
  const anchorMs = useMemo(() => turnStartedAtMs(timeline), [timeline]);

  /**
   * Start / stop the ticker on the streaming edge only.
   * Resetting `seenAtMs` here is what makes each turn count from zero, and
   * clearing the interval when the turn ends keeps an idle app at 0 timers.
   */
  useEffect(() => {
    if (!streaming) {
      setSeenAtMs(null);
      return;
    }
    const startedAt = Date.now();
    setSeenAtMs(startedAt);
    setNowMs(startedAt);
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [streaming]);

  /**
   * Prefer the turn's own first timestamped step so switching back to a session
   * that has been working for minutes does not restart the clock at 0; fall
   * back to first-observed when the turn is pure tool work (no timestamps).
   */
  const startedAtMs =
    seenAtMs === null ? null : Math.min(seenAtMs, anchorMs ?? seenAtMs);
  const elapsedMs =
    startedAtMs === null ? 0 : Math.max(0, nowMs - startedAtMs);

  return {
    line,
    elapsedLabel: formatWorkedDuration(elapsedMs),
  };
}
