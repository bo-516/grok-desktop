/**
 * Stream control in front of the dispatcher's message branches: bridge
 * provenance first (so admission sees it before the frame paints), then the
 * seq/epoch gate, plus the two frame types that only exist for them
 * (`resync_result`, provenance-carrying `info`).
 */

import type { ReplayDispatchClock } from "./liveBridgeReplay";
import { createProvenanceRelay } from "./liveBridgeProvenance";
import { createStreamGate } from "./liveBridgeStreamGate";
import type { BridgeServerMsg, LiveBridgeHandlers } from "./liveBridgeTypes";

/** Options for createStreamControl. */
export type StreamControlOpts = {
  /** Connection handlers (onProvenance / onStreamReset / onInfo used here). */
  handlers: LiveBridgeHandlers;
  /** Timer source for resync timeouts. */
  clock?: ReplayDispatchClock;
  /** Socket send for `resync` / `get_state`; omitted → local re-anchor only. */
  send?: (msg: Record<string, unknown>) => boolean;
  /** Drain coalesced notifies (before a resync or an immediate notice). */
  flush: () => void;
  /** Re-dispatch one frame of a resync answer. */
  replay: (frame: BridgeServerMsg) => void;
  /** Override the resync answer timeout. */
  resyncTimeoutMs?: number;
};

/** Per-connection stream control. */
export type StreamControl = {
  /**
   * Run provenance + gate for one frame.
   * @param msg Inbound frame.
   * @returns True when the frame was fully handled here (resync answer,
   *   dropped duplicate / gap, provenance info) and the dispatcher must stop.
   */
  intercept: (msg: BridgeServerMsg) => boolean;
  /** Remember a `start` request id sent on this connection. */
  noteOwnStart: (startId: string) => void;
  /** Test/observe: stream keys with a resync in flight. */
  pendingResyncs: () => string[];
  /** Forget positions, pending resyncs and provenance (socket close). */
  clear: () => void;
};

/**
 * Create stream control for one bridge connection.
 * @param opts Handlers, clock, send, coalescer drain and replay sink.
 * @returns Control object the dispatcher calls first for every frame.
 */
export function createStreamControl(opts: StreamControlOpts): StreamControl {
  const { handlers } = opts;
  const gate = createStreamGate({
    clock: opts.clock,
    send: opts.send,
    beforeResync: opts.flush,
    replay: opts.replay,
    onReset: handlers.onStreamReset,
    resyncTimeoutMs: opts.resyncTimeoutMs,
  });
  const provenance = createProvenanceRelay(handlers);

  return {
    intercept: (msg) => {
      if (msg.type === "resync_result") {
        gate.handleResyncResult(msg);
        return true;
      }
      const asserted = provenance.note(msg);
      if (!gate.admit(msg)) {
        return true;
      }
      if (msg.type === "info" && asserted) {
        // Notices run after every pending paint (same rule as routeBridgeNotice).
        opts.flush();
        handlers.onInfo?.(msg.message, msg.sessionId, { provenance: asserted });
        return true;
      }
      return false;
    },
    noteOwnStart: provenance.noteOwnStart,
    pendingResyncs: gate.pendingResyncs,
    clear: () => {
      gate.clear();
      provenance.clear();
    },
  };
}
