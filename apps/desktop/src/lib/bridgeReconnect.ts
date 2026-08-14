/**
 * Live-bridge reconnect cadence while the WebSocket is down.
 * Purpose: keep trying to reach the real grok-build bridge so the user does
 * not have to click Reconnect after `npm run bridge`.
 * Boundary: no store / network; callers pass the reconnect thunk and host timers.
 */

/** Milliseconds between automatic reconnect attempts while disconnected. */
export const BRIDGE_RECONNECT_MS = 3_000;

/**
 * Host interval surface so tests can inject fakes without touching `window`.
 * `T` is the host timer id (`number` in DOM, `Timeout` under @types/node).
 */
export type BridgeReconnectTimers<T = unknown> = {
  /** Arm the repeating reconnect tick; returns an id `clearInterval` understands. */
  setInterval: (handler: () => void, ms: number) => T;
  /** Cancel the repeating reconnect tick. */
  clearInterval: (id: T) => void;
};

/**
 * How an automatic reconnect should talk to the bridge.
 * `connectOnly` opens the WebSocket without session/start (New chat draft /
 * empty catalog). Otherwise resume the named ACP session.
 */
export type AutoReconnectPlan =
  | { connectOnly: true }
  | { connectOnly: false; resumeId: string };

/**
 * Whether the shell should keep retrying a live-bridge connect.
 * Only `disconnected` arms the loop; `connecting` / `live-bridge` must not
 * stack a second start while one is already in flight.
 * @param connectionMode Current session-store connection mode.
 * @returns True when an interval should be running.
 */
export function shouldArmBridgeReconnect(connectionMode: string): boolean {
  return connectionMode === "disconnected";
}

/**
 * Pick resume vs connect-only for an automatic retry.
 * Viewing / current canvas id wins. Catalog[0] is only used when the user is
 * not on a New chat draft — otherwise a background retry would steal the draft.
 * @param source Viewing id, canvas id, draft flag, and first catalog id.
 * @returns connectOnly when no session should be resumed.
 */
export function resolveAutoReconnectStart(source: {
  /** Rail / canvas viewing id; empty or null means none. */
  viewingSessionId: string | null;
  /** Painted canvas session id (may be empty on a draft). */
  sessionId: string;
  /** True while New chat has not sent yet. */
  localDraft: boolean;
  /** First catalog row id when the rail is non-empty. */
  catalogId?: string;
}): AutoReconnectPlan {
  const viewing = source.viewingSessionId?.trim() ?? "";
  const sessionId = source.sessionId.trim();
  const catalogId = source.catalogId?.trim() ?? "";
  const resumeId =
    viewing || sessionId || (source.localDraft ? "" : catalogId);
  if (!resumeId) {
    return { connectOnly: true };
  }
  return { connectOnly: false, resumeId };
}

/**
 * Arm a 3s reconnect interval. Does not fire immediately — the shell already
 * attempts once on mount; this is the retry cadence after a drop or failed
 * connect. Overlapping `attempt` calls are dropped so a slow connect cannot
 * stack. Rejection is swallowed (the next tick retries).
 * @typeParam T Host timer id type (`number` in the browser).
 * @param attempt Reconnect thunk (store `ensureConnected`).
 * @param timers Host interval APIs (`window` in the hook).
 * @returns Cleanup that clears the interval.
 */
export function startBridgeReconnectLoop<T = unknown>(
  attempt: () => Promise<void>,
  timers: BridgeReconnectTimers<T>,
): () => void {
  /** True while `attempt` has not settled; overlapping ticks are dropped. */
  const flight = { current: false };
  const id = timers.setInterval(() => {
    if (flight.current) {
      return;
    }
    flight.current = true;
    void attempt()
      .catch(() => undefined)
      .finally(() => {
        flight.current = false;
      });
  }, BRIDGE_RECONNECT_MS);
  return () => {
    timers.clearInterval(id);
  };
}
