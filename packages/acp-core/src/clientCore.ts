/**
 * AcpClient plumbing: transport wiring, JSON-RPC id pairing, the session
 * snapshot + replay window, quiet-settle timing, inbound dispatch, and the
 * permission / cancel replies dispatch itself needs (auto-approve).
 * Session-level operations (handshake, prompt, model/mode, compact, fork)
 * live on the AcpClient subclass in client.ts.
 */

import {
  decodeLine,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from "./codec.js";
import { createSessionState } from "./timeline.js";
import {
  buildPermissionOutcome,
  clearPendingPermission,
  markDisconnected,
  markPromptSettled,
} from "./sessionLifecycle.js";
import type { AcpTransport } from "./transport.js";
import type { JsonRpcMessage, SessionState } from "./types.js";
import type { AcpClientOptions } from "./clientOptions.js";
import { dispatchAcpMessage } from "./clientDispatch.js";
import { EventIdDedupe } from "./eventIdDedupe.js";
import { shouldArmQuietSettle } from "./sessionLiveStatus.js";

/**
 * Transport + snapshot core shared by AcpClient. Abstract so it is only
 * used through AcpClient; it declares no abstract members, and subclasses
 * must not declare class fields (they would re-initialize after the base
 * constructor has already wired transport callbacks).
 */
export abstract class AcpClientCore {
  private readonly transport: AcpTransport;
  private readonly settleQuietMs: number;
  private readonly autoPermissionOptionId: string | null;
  private readonly onStateChange?: (state: SessionState) => void;
  /** Raw update relay; protected so prompt usage can fan out a synthetic turn_completed. */
  protected readonly onSessionUpdate?: AcpClientOptions["onSessionUpdate"];
  private readonly onReplayChange?: AcpClientOptions["onReplayChange"];
  private readonly onStderr?: (line: string) => void;
  private readonly onAgentRequest?: AcpClientOptions["onAgentRequest"];

  private nextId = 1;
  private readonly pending = new Map<
    number | string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }
  >();
  /** Current snapshot; replaced (never mutated) through setState. */
  protected state: SessionState;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a session/prompt RPC awaits its response. */
  protected promptInFlight = false;
  /**
   * True once this process has sent session/prompt.
   * session/load of a still-running turn has no local prompt RPC; quiet
   * settle must not flip that turn idle on every thought/tool gap.
   */
  protected promptOriginated = false;
  private disposed = false;
  /** Set-based eventId ring so redelivered session/update does not double-apply. */
  private readonly eventDedupe = new EventIdDedupe();
  /**
   * True while a `session/load` replay is in flight. The snapshot still absorbs
   * every replayed chunk, but listeners are not notified until the window
   * closes, so restoring history costs one repaint instead of one per chunk
   * and the UI never mistakes replayed history for a live turn.
   */
  private replaying = false;

  /**
   * Wire transport callbacks and start from an empty snapshot.
   * @param opts Transport plus optional listeners; see AcpClientOptions.
   */
  constructor(opts: AcpClientOptions) {
    this.transport = opts.transport;
    this.settleQuietMs = opts.settleQuietMs ?? 200;
    this.autoPermissionOptionId =
      opts.autoPermissionOptionId === undefined
        ? null
        : opts.autoPermissionOptionId;
    this.onStateChange = opts.onStateChange;
    this.onSessionUpdate = opts.onSessionUpdate;
    this.onReplayChange = opts.onReplayChange;
    this.onStderr = opts.onStderr;
    this.onAgentRequest = opts.onAgentRequest;
    this.state = createSessionState({ id: "", workspace: "" });

    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onClose?.(() => {
      // A transport death during replay must reach listeners; the pending
      // session/load can never flush, so drop the gate before the paint.
      const wasReplaying = this.replaying;
      const sid = this.state.id;
      this.replaying = false;
      if (wasReplaying) {
        this.onReplayChange?.(false, sid);
      }
      this.setState(markDisconnected(this.state));
      for (const [, p] of this.pending) {
        p.reject(new Error("ACP transport closed"));
      }
      this.pending.clear();
    });
    this.transport.onStderr?.((chunk) => {
      this.onStderr?.(chunk);
    });
  }

  /** Current session snapshot (immutable reference; replace on each setState). */
  getSessionState(): SessionState {
    return this.state;
  }

  /**
   * Replace session snapshot (used when bridge seeds cache before replay).
   * @param state Next SessionState (not mutated in place by the client).
   */
  replaceSessionState(state: SessionState): void {
    // New session id → drop prior stream's eventIds so load replay can re-apply.
    if (state.id && state.id !== this.state.id) {
      this.eventDedupe.clear();
    }
    this.setState(state);
  }

  /**
   * Open or close the `session/load` replay window.
   * While open, replayed chunks mutate the snapshot silently; closing emits
   * onReplayChange(false) then one onStateChange with the finished transcript.
   * Callers must always close the window they opened (including on RPC failure),
   * otherwise the session goes mute and no later live update ever reaches the UI.
   * @param on True to suppress per-chunk state fan-out, false to close and flush once.
   */
  setReplaying(on: boolean): void {
    if (this.replaying === on) {
      return;
    }
    this.replaying = on;
    const sessionId = this.state.id;
    if (on) {
      this.onReplayChange?.(true, sessionId);
      return;
    }
    // Replay leaves no live turn behind: drop the pending settle so it cannot
    // fire a second full-timeline repaint right after the flush.
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    // Notify bridges first so they can emit replay_end before the state paint.
    this.onReplayChange?.(false, sessionId);
    this.onStateChange?.(this.state);
  }

  /** Whether a session/load replay window is currently open. */
  isReplaying(): boolean {
    return this.replaying;
  }

  /** Cancel the current turn (notification; late updates may still arrive). */
  cancel(sessionId: string): void {
    this.transport.write(
      encodeNotification("session/cancel", { sessionId }),
    );
    this.scheduleSettle({ force: true });
  }

  /**
   * Respond to a pending session/request_permission.
   * Also clears waiting_permission in local state.
   * @param optionId Permission option id from the agent request.
   */
  respondPermission(optionId: string): void {
    const pending = this.state.pendingPermission;
    if (!pending) {
      throw new Error("No pending permission request");
    }
    this.transport.write(
      encodeResponse(pending.requestId, buildPermissionOutcome(optionId)),
    );
    const stop = optionId === "deny_and_stop";
    this.setState(
      clearPendingPermission(this.state, stop ? "idle" : "streaming"),
    );
    if (stop && this.state.id) {
      this.cancel(this.state.id);
    }
  }

  /** JSON-RPC request with id pairing. */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("AcpClient disposed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.transport.write(encodeRequest(id, method, params));
    });
  }

  /** Stop the settle timer and release the transport; later requests reject. */
  dispose(): void {
    this.disposed = true;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    this.transport.dispose?.();
  }

  // --- internals ---

  /**
   * Swap the snapshot and notify onStateChange unless a replay window is open.
   * @param next Replacement snapshot (callers build a new object, never mutate).
   */
  protected setState(next: SessionState): void {
    this.state = next;
    if (this.replaying) {
      // Coalesced into the single flush in setReplaying(false).
      return;
    }
    this.onStateChange?.(next);
  }

  /**
   * Arm the idle quiet window.
   * After session/load this process has not sent a prompt; skip the short
   * quiet settle so a still-running turn does not flicker Worked on every
   * tool gap. `{ force: true }` is turn_completed / cancel.
   * @param opts.force Settle even when no local prompt was sent.
   */
  protected scheduleSettle(opts?: { force?: boolean }): void {
    if (
      !shouldArmQuietSettle({
        force: opts?.force,
        promptOriginated: this.promptOriginated,
        promptInFlight: this.promptInFlight,
      })
    ) {
      return;
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => {
      if (this.promptInFlight) {
        return;
      }
      if (this.state.status === "waiting_permission") {
        return;
      }
      if (this.state.status === "disconnected") {
        return;
      }
      this.setState(markPromptSettled(this.state));
    }, this.settleQuietMs);
  }

  /**
   * Decode one NDJSON line and dispatch it; malformed lines are dropped.
   * @param line Raw transport line.
   */
  private handleLine(line: string): void {
    const decoded = decodeLine(line);
    if (!decoded.ok) {
      return;
    }
    this.dispatchMessage(decoded.message);
  }

  /**
   * Public for tests: feed a fully decoded JSON-RPC message through the same path.
   * @param message Decoded JSON-RPC message.
   */
  dispatchMessage(message: JsonRpcMessage): void {
    dispatchAcpMessage(
      {
        pending: this.pending,
        getSessionState: () => this.getSessionState(),
        replaceSessionState: (state) => this.replaceSessionState(state),
        write: (line) => this.transport.write(line),
        scheduleSettle: (settleOpts) => this.scheduleSettle(settleOpts),
        isPromptInFlight: () => this.promptInFlight,
        autoPermissionOptionId: this.autoPermissionOptionId,
        respondPermission: (optionId) => this.respondPermission(optionId),
        onSessionUpdate: this.onSessionUpdate,
        acceptEventId: (eventId) => this.eventDedupe.accept(eventId),
        onAgentRequest: this.onAgentRequest,
      },
      message,
    );
  }
}
