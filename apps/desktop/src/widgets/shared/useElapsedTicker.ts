/**
 * Shared 1s wall-clock ticker for live subagent elapsed labels.
 * One interval is shared by L1 groups and the Agents panel so a fan-out
 * does not spawn N independent timers.
 */

import { useEffect, useState } from "react";

/** Listeners that want the shared 1s tick. */
const listeners = new Set<(nowMs: number) => void>();
/** Active interval id, or null when nobody is subscribed. */
let intervalId: number | null = null;
/** First-seen running clocks, shared so L1 and the panel agree. */
const runningStartedAt = new Map<string, number>();

/**
 * Start the singleton interval if it is not already running.
 */
function ensureTicker(): void {
  if (intervalId != null || typeof window === "undefined") {
    return;
  }
  intervalId = window.setInterval(() => {
    const nowMs = Date.now();
    for (const listener of listeners) {
      listener(nowMs);
    }
  }, 1000);
}

/**
 * Stop the singleton interval when the last subscriber unmounts.
 */
function maybeStopTicker(): void {
  if (listeners.size > 0 || intervalId == null || typeof window === "undefined") {
    return;
  }
  window.clearInterval(intervalId);
  intervalId = null;
}

/**
 * Tick Date.now() once a second while `active` is true.
 * Multiple callers share one interval.
 * @param active True while at least one subagent (or group) is running.
 * @returns Current epoch ms; frozen when inactive.
 */
export function useElapsedTicker(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    const listener = (next: number) => {
      setNowMs(next);
    };
    listeners.add(listener);
    ensureTicker();
    return () => {
      listeners.delete(listener);
      maybeStopTicker();
    };
  }, [active]);

  return nowMs;
}

/**
 * Remember the first wall-clock we saw a running card. Shared by L1 and panel.
 * @param id Subagent or tool-call id used as the clock key.
 * @param nowMs Current epoch ms.
 * @returns Existing start ms, or `nowMs` when this is the first sighting.
 */
export function rememberSubagentStartedAt(id: string, nowMs: number): number {
  const existing = runningStartedAt.get(id);
  if (existing !== undefined) {
    return existing;
  }
  runningStartedAt.set(id, nowMs);
  return nowMs;
}

/**
 * Look up a shared start clock without recording a new one.
 * @param id Subagent or tool-call id.
 * @returns Epoch ms, or undefined when this id has not been seen running.
 */
export function peekSubagentStartedAt(id: string): number | undefined {
  return runningStartedAt.get(id);
}

/**
 * Drop shared start clocks (unit tests only).
 */
export function resetElapsedTickerForTests(): void {
  runningStartedAt.clear();
  listeners.clear();
  if (intervalId != null && typeof window !== "undefined") {
    window.clearInterval(intervalId);
  }
  intervalId = null;
}
