/**
 * Live stream coalescing for the relay path.
 *
 * The dispatcher still reduces every `session_update` into its per-session
 * bucket immediately, so ordering and dedupe stay exact. This module only
 * decides *when* the store hears about it:
 * - viewed (foreground) sessions: at most once per animation frame;
 * - background sessions: at most once per {@link BACKGROUND_FLUSH_MS};
 * - urgent transitions ({@link needsImmediateFlush}) and every immediate
 *   dispatcher notify: drain everything pending first, in arrival order.
 *
 * It never holds SessionState: `emit` reads the bucket at flush time, so a
 * seed / hydrate that lands between `defer` and the flush is never painted
 * stale. Seam for later layers (bridge sequence numbers / gap resync): they
 * sit in the dispatcher before `defer` / `emitNow` and can call `flushAll`
 * before a resync; nothing here needs to know about them.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  createFrameScheduler,
  type CancelScheduled,
  type StreamFrameScheduler,
} from "./liveBridgeFrameScheduler";

/**
 * Background (non-viewed) session flush interval (ms). Rail previews update
 * at ~6–7 Hz; rail status still moves instantly through urgent flushes.
 */
export const BACKGROUND_FLUSH_MS = 150;

/** Tuning knobs the dispatcher accepts (connectLiveBridge passes them). */
export type LiveStreamCoalesceOpts = {
  /** Frame / timer source; defaults to createFrameScheduler(). */
  scheduler?: StreamFrameScheduler;
  /**
   * Whether a session owns the painted canvas. Foreground sessions flush per
   * frame, others per `backgroundFlushMs`. Omitted → every session is foreground.
   * Evaluated on every deferred update, so a session switch takes effect on
   * the next chunk.
   * @param sessionId Wire session id ("" for the provisional bucket).
   */
  isForeground?: (sessionId: string) => boolean;
  /** Background lane interval (ms); defaults to BACKGROUND_FLUSH_MS. */
  backgroundFlushMs?: number;
};

/** Options for createStreamCoalescer. */
export type StreamCoalescerOpts = LiveStreamCoalesceOpts & {
  /**
   * Notify the store for one session. Must read the session's current bucket
   * state (the coalescer stores no snapshot).
   * @param sessionId Session whose pending notify is due.
   * @param eventId Latest wire eventId folded into this notify (may be undefined).
   */
  emit: (sessionId: string, eventId: string | undefined) => void;
};

/** Per-connection coalescing state. */
export type StreamCoalescer = {
  /**
   * Mark a session dirty and schedule its notify on its lane. Repeated calls
   * before the flush fold into one notify carrying the latest eventId.
   * @param sessionId Session whose bucket just changed.
   * @param eventId Wire eventId of the update (undefined keeps the previous one).
   */
  defer: (sessionId: string, eventId: string | undefined) => void;
  /**
   * Notify a session right now: drain every other pending session in
   * arrival order, then emit this one once (its pending entry folds in).
   * @param sessionId Session with an urgent transition.
   * @param eventId Wire eventId of the urgent update (undefined keeps pending one).
   */
  emitNow: (sessionId: string, eventId: string | undefined) => void;
  /**
   * Emit every pending session now, in arrival order, and cancel timers.
   * Call before any immediate notify, socket close, session switch, replay.
   */
  flushAll: () => void;
  /** Session ids still waiting for a notify, in arrival order (test/observe). */
  pendingIds: () => string[];
};

/** One dirty session waiting for its notify. */
type PendingEntry = {
  /** Latest wire eventId folded into this entry. */
  eventId: string | undefined;
  /** Which flush cadence owns the entry. */
  lane: "frame" | "background";
  /** Background lane timer; undefined on the frame lane. */
  cancelTimer?: CancelScheduled;
};

/**
 * Whether a reduced update changes something the UI must show at once:
 * status edges (turn start / settle, waiting_permission, disconnected,
 * error), permission requests, mode / model / config changes, errors.
 * Pure; compares field identity, so equal-but-rebuilt objects count as change.
 * @param before Bucket state before the update.
 * @param next Bucket state after the update.
 * @returns True when the notify must bypass the frame / background wait.
 */
export function needsImmediateFlush(
  before: SessionState,
  next: SessionState,
): boolean {
  return (
    before.status !== next.status ||
    before.pendingPermission !== next.pendingPermission ||
    before.mode !== next.mode ||
    before.model !== next.model ||
    before.errorMessage !== next.errorMessage ||
    before.configOptions !== next.configOptions
  );
}

/**
 * Create the coalescer for one bridge connection.
 * @param opts Emit callback plus optional scheduler / lane predicate / interval.
 * @returns Coalescer whose state lives only in this closure.
 */
export function createStreamCoalescer(
  opts: StreamCoalescerOpts,
): StreamCoalescer {
  const scheduler = opts.scheduler ?? createFrameScheduler();
  const backgroundMs = opts.backgroundFlushMs ?? BACKGROUND_FLUSH_MS;
  /** Dirty sessions; Map insertion order is arrival order. */
  const pending = new Map<string, PendingEntry>();
  /** Outstanding frame request shared by every foreground session. */
  const frame: { cancel: CancelScheduled | null } = { cancel: null };

  /**
   * Drop a session's entry (and its timer) and notify it.
   * @param sessionId Session to emit.
   * @param eventId Override eventId (undefined keeps the entry's).
   */
  function emitEntry(sessionId: string, eventId?: string): void {
    const entry = pending.get(sessionId);
    pending.delete(sessionId);
    entry?.cancelTimer?.();
    opts.emit(sessionId, eventId ?? entry?.eventId);
  }

  /** Cancel the shared frame when no frame-lane entry is left. */
  function releaseIdleFrame(): void {
    if (!frame.cancel) {
      return;
    }
    for (const entry of pending.values()) {
      if (entry.lane === "frame") {
        return;
      }
    }
    frame.cancel();
    frame.cancel = null;
  }

  /** Frame tick: emit every frame-lane entry once, in arrival order. */
  function runFrame(): void {
    frame.cancel = null;
    const due = [...pending].filter(([, entry]) => entry.lane === "frame");
    for (const [sessionId] of due) {
      // Re-check: an earlier emit may have flushed this entry re-entrantly.
      if (pending.get(sessionId)?.lane === "frame") {
        emitEntry(sessionId);
      }
    }
  }

  /** Request the shared frame unless one is already outstanding. */
  function ensureFrame(): void {
    if (!frame.cancel) {
      frame.cancel = scheduler.requestFrame(runFrame);
    }
  }

  /**
   * Put an entry on the frame lane (cancels a background timer).
   * @param entry Entry to promote.
   */
  function toFrameLane(entry: PendingEntry): void {
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
    entry.lane = "frame";
    ensureFrame();
  }

  /**
   * See {@link StreamCoalescer.defer}.
   * @param sessionId Dirty session.
   * @param eventId Latest eventId.
   */
  function defer(sessionId: string, eventId: string | undefined): void {
    const prev = pending.get(sessionId);
    if (prev) {
      prev.eventId = eventId ?? prev.eventId;
      // Became the viewed session while waiting on the slow lane.
      if (prev.lane === "background" && (opts.isForeground?.(sessionId) ?? true)) {
        toFrameLane(prev);
      }
      return;
    }
    const foreground = opts.isForeground?.(sessionId) ?? true;
    const entry: PendingEntry = { eventId, lane: "background" };
    pending.set(sessionId, entry);
    if (foreground) {
      toFrameLane(entry);
      return;
    }
    entry.cancelTimer = scheduler.delay(() => {
      // Timer already consumed; emitEntry must not cancel it again.
      entry.cancelTimer = undefined;
      if (pending.get(sessionId) === entry) {
        emitEntry(sessionId);
      }
    }, backgroundMs);
  }

  /** See {@link StreamCoalescer.flushAll}. */
  function flushAll(): void {
    // Re-read the live map each turn: emits may re-enter and flush entries.
    for (;;) {
      const first = pending.keys().next();
      if (first.done) {
        break;
      }
      emitEntry(first.value);
    }
    releaseIdleFrame();
  }

  /**
   * See {@link StreamCoalescer.emitNow}.
   * @param sessionId Urgent session.
   * @param eventId Urgent update's eventId.
   */
  function emitNow(sessionId: string, eventId: string | undefined): void {
    const own = pending.get(sessionId);
    pending.delete(sessionId);
    own?.cancelTimer?.();
    flushAll();
    opts.emit(sessionId, eventId ?? own?.eventId);
  }

  return {
    defer,
    emitNow,
    flushAll,
    pendingIds: () => [...pending.keys()],
  };
}
