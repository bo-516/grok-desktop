/**
 * Adaptive list_pool poll + shallow write fingerprint for pool entries.
 * Extracted from sessionStoreLive so connect/start stays under the line limit.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import type { PoolEntry } from "../bridge/liveBridge";

/**
 * Footer "N running" safety poll while any pool entry is streaming.
 * Primary updates are event-driven (`onPool` / `broadcastPool`); this interval
 * covers missed events / process death without ACP notification.
 */
export const POOL_POLL_ACTIVE_MS = 1000;

/**
 * Idle list_pool interval when no pool entry is streaming.
 * Longer than active so idle 1 Hz store writes do not keep the rail hot.
 */
export const POOL_POLL_IDLE_MS = 5000;

/**
 * @deprecated Prefer {@link POOL_POLL_ACTIVE_MS}; kept equal for existing imports.
 */
export const POOL_POLL_MS = POOL_POLL_ACTIVE_MS;

/** Active pool list_pool timer; null when disconnected. */
let poolPollTimer: ReturnType<typeof setInterval> | null = null;

/** Last interval used by the adaptive pool poll (for restart on phase change). */
let poolPollIntervalMs = POOL_POLL_ACTIVE_MS;

/** Last fingerprint written by onPool (skip set when status tuple unchanged). */
let lastPoolFingerprint = "";

/**
 * Compact pool row fingerprint for shallow write gating.
 * @param entries Pool entries from bridge.
 * @returns Stable string of sessionId|status|live triples.
 */
export function poolEntriesFingerprint(entries: PoolEntry[]): string {
  return entries
    .map((e) => `${e.sessionId}|${e.status}|${e.live ? 1 : 0}`)
    .join(";");
}

/**
 * Whether the latest pool fingerprint matches the last written one.
 * Updates the module stamp when different so callers can gate set().
 * @param entries Latest pool entries.
 * @returns True when fingerprint is unchanged (skip store write).
 */
export function poolFingerprintUnchanged(entries: PoolEntry[]): boolean {
  const fp = poolEntriesFingerprint(entries);
  if (fp === lastPoolFingerprint) {
    return true;
  }
  lastPoolFingerprint = fp;
  return false;
}

/**
 * Stop the list_pool poll (disconnect / reconnect / close).
 * Safe when no timer is running.
 */
export function stopPoolPoll(): void {
  if (poolPollTimer !== null) {
    clearInterval(poolPollTimer);
    poolPollTimer = null;
  }
  lastPoolFingerprint = "";
}

/**
 * Whether any pool entry is currently streaming (AI outputting).
 * @param entries Current pool snapshot.
 * @returns True when at least one live streaming row exists.
 */
export function poolHasStreaming(entries: PoolEntry[]): boolean {
  return entries.some((e) => e.live && e.status === "streaming");
}

/**
 * Promote the painted canvas to busy when the viewed session is still live
 * in the pool. Never demotes — live session_update / settle own the idle edge,
 * so a stale list_pool idle must not wipe Working mid-turn.
 * @param session Currently painted canvas.
 * @param viewingSessionId Explicit rail selection (used when canvas id is empty).
 * @param entries Latest pool snapshot.
 * @param restoringSessionId Session waiting on disk/load hydrate; pool
 *   `streaming` during session/load must not flip the canvas to Working.
 * @returns Same session reference when nothing changes.
 */
export function applyPoolBusyToSession(
  session: SessionState,
  viewingSessionId: string | null,
  entries: PoolEntry[],
  restoringSessionId?: string | null,
): SessionState {
  const targetId = session.id.trim() || viewingSessionId?.trim() || "";
  if (!targetId) {
    return session;
  }
  if (restoringSessionId && restoringSessionId === targetId) {
    return session;
  }
  if (session.id.trim() && session.id !== targetId) {
    return session;
  }
  const entry = entries.find((row) => row.sessionId === targetId && row.live);
  if (!entry) {
    return session;
  }
  if (entry.status !== "streaming" && entry.status !== "waiting_permission") {
    return session;
  }
  // Permission is more specific than a later streaming poll tick.
  if (
    session.status === "waiting_permission" &&
    entry.status === "streaming"
  ) {
    return session;
  }
  if (session.status === entry.status) {
    return session;
  }
  return { ...session, status: entry.status };
}

/**
 * Start (or restart) the adaptive list_pool poll.
 * Active (1s) while any entry streams; idle (5s) otherwise.
 * @param listPool Bridge client method; return value ignored (false = WS closed).
 * @param getEntries Optional snapshot of current pool for initial interval pick.
 */
export function startPoolPoll(
  listPool: () => boolean,
  getEntries?: () => PoolEntry[],
): void {
  stopPoolPoll();
  const streaming = getEntries ? poolHasStreaming(getEntries()) : true;
  poolPollIntervalMs = streaming ? POOL_POLL_ACTIVE_MS : POOL_POLL_IDLE_MS;
  poolPollTimer = setInterval(() => {
    listPool();
  }, poolPollIntervalMs);
}

/**
 * Retarget the poll interval when streaming phase changes (no-op if same).
 * @param listPool Bridge list_pool.
 * @param entries Latest pool entries.
 */
export function retargetPoolPoll(
  listPool: () => boolean,
  entries: PoolEntry[],
): void {
  const next = poolHasStreaming(entries)
    ? POOL_POLL_ACTIVE_MS
    : POOL_POLL_IDLE_MS;
  if (next === poolPollIntervalMs && poolPollTimer !== null) {
    return;
  }
  startPoolPoll(listPool, () => entries);
}
