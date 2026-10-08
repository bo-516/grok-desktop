/**
 * Client half of the integrated-terminal protocol (`terminal_*` frames).
 *
 * Owns per-terminal input sequencing (the bridge dispatches each WS frame on
 * its own goroutine and re-orders by `seq`), request/response correlation for
 * create/list, base64 output decoding, and a replay backlog so output that
 * races ahead of `terminal_created` (or of the xterm mount) is not lost.
 * Flow control is the listener's job: it acks bytes after xterm renders them.
 */

import type {
  LiveBridgeTerminal,
  TerminalExit,
  TerminalListener,
  TerminalServerMsg,
} from "./liveBridgeTerminalTypes";

/** How long create / list wait for the bridge before rejecting. */
export const TERMINAL_REQUEST_TIMEOUT_MS = 15_000;

/** Timer seam so tests can drive timeouts without real time. */
export type TerminalClock = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/** Channel returned by {@link createLiveBridgeTerminal}. */
export type LiveBridgeTerminalChannel = {
  /** Public API mounted on the live bridge handle as `terminal`. */
  api: LiveBridgeTerminal;
  /**
   * Consume one inbound frame.
   * @param msg Any decoded bridge message.
   * @returns true when it was a `terminal_*` frame (handled here).
   */
  handleServerMsg: (msg: { type: string }) => boolean;
  /**
   * Socket closed: every live terminal ends as `disconnected` (the bridge
   * kills a socket's terminals on disconnect) and pending requests reject.
   * @param message Reason shown to the user.
   */
  closeAll: (message: string) => void;
};

/** Client-side state of one terminal id. */
type TerminalRecord = {
  /** Last `seq` used for input / resize (bridge expects 1, 2, 3, …). */
  seq: number;
  /** Attached sink, or null while nobody listens. */
  listener: TerminalListener | null;
  /** Output received while no listener was attached (bounded by the bridge credit window). */
  backlog: Uint8Array[];
  /** Final state once ended; null while running. */
  exit: TerminalExit | null;
};

/** One in-flight create / list request. */
type PendingRequest = {
  /** Settles the caller's promise with the decoded reply. */
  resolve: (msg: TerminalServerMsg) => void;
  /** Rejects the caller's promise (timeout / socket close). */
  reject: (error: Error) => void;
  /** Timeout handle from the clock. */
  timer: unknown;
};

/**
 * Decode base64 into raw bytes (output frames carry arbitrary PTY bytes).
 * @param data Standard base64 text; invalid input yields an empty array.
 * @returns The decoded bytes.
 */
export function decodeBase64Bytes(data: string): Uint8Array {
  try {
    const binary = atob(data);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Encode an xterm `onBinary` string (one char per byte, 0–255) as base64.
 * @param data Binary string; chars above 0xFF are truncated to their low byte.
 * @returns Base64 text for `dataBase64`.
 */
export function binaryStringToBase64(data: string): string {
  let safe = "";
  for (let i = 0; i < data.length; i++) {
    safe += String.fromCharCode(data.charCodeAt(i) & 0xff);
  }
  return btoa(safe);
}

/**
 * Create the terminal channel for one bridge socket.
 * @param send Socket writer; returns false when the socket is not open.
 * @param clock Optional timer seam (tests).
 * @returns API + inbound handler + close hook.
 */
export function createLiveBridgeTerminal(
  send: (message: unknown) => boolean,
  clock: TerminalClock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): LiveBridgeTerminalChannel {
  const records = new Map<string, TerminalRecord>();
  const pending = new Map<string, PendingRequest>();
  const counter = { request: 0 };

  /**
   * Get or create the record for an id (output may precede terminal_created).
   * @param terminalId Bridge terminal id.
   */
  function recordFor(terminalId: string): TerminalRecord {
    const existing = records.get(terminalId);
    if (existing) {
      return existing;
    }
    const created: TerminalRecord = { seq: 0, listener: null, backlog: [], exit: null };
    records.set(terminalId, created);
    return created;
  }

  /**
   * Mark a terminal ended (first exit wins) and notify its listener.
   * @param terminalId Bridge terminal id.
   * @param exit Final state.
   */
  function finish(terminalId: string, exit: TerminalExit): void {
    const record = recordFor(terminalId);
    if (record.exit) {
      return;
    }
    record.exit = exit;
    record.listener?.onExit(exit);
  }

  /**
   * Send a correlated request and wait for its reply frame.
   * @param message Frame without requestId.
   * @param label Used in timeout / offline errors.
   */
  function request(message: Record<string, unknown>, label: string): Promise<TerminalServerMsg> {
    counter.request += 1;
    const requestId = `term-${counter.request}`;
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${label} timed out`));
      }, TERMINAL_REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
      if (!send({ ...message, requestId })) {
        clock.clearTimeout(timer);
        pending.delete(requestId);
        reject(new Error("Bridge WebSocket is not connected"));
      }
    });
  }

  /**
   * Send an ordered op (input / resize) with the next per-terminal seq.
   * @param terminalId Target terminal.
   * @param message Frame body without terminalId / seq.
   */
  function sendOrdered(terminalId: string, message: Record<string, unknown>): boolean {
    const record = recordFor(terminalId);
    if (record.exit) {
      return false;
    }
    record.seq += 1;
    return send({ ...message, terminalId, seq: record.seq });
  }

  const api: LiveBridgeTerminal = {
    create: async (opts) => {
      const reply = await request({ type: "terminal_create", ...opts }, "terminal_create");
      if (reply.type !== "terminal_created" || !reply.ok || !reply.terminal) {
        throw new Error(
          reply.type === "terminal_created" && reply.error ? reply.error : "terminal_create failed",
        );
      }
      recordFor(reply.terminal.terminalId);
      return reply.terminal;
    },
    list: async () => {
      const reply = await request({ type: "terminal_list" }, "terminal_list");
      return reply.type === "terminal_list_result" ? reply.terminals : [];
    },
    write: (terminalId, data) => sendOrdered(terminalId, { type: "terminal_input", data }),
    writeBinary: (terminalId, data) =>
      sendOrdered(terminalId, { type: "terminal_input", dataBase64: binaryStringToBase64(data) }),
    resize: (terminalId, cols, rows) =>
      sendOrdered(terminalId, { type: "terminal_resize", cols, rows }),
    ack: (terminalId, bytes) =>
      bytes > 0 && send({ type: "terminal_ack", terminalId, bytes }),
    kill: (terminalId) => send({ type: "terminal_kill", terminalId }),
    subscribe: (terminalId, listener) => {
      const record = recordFor(terminalId);
      record.listener = listener;
      const backlog = record.backlog;
      record.backlog = [];
      for (const chunk of backlog) {
        listener.onOutput(chunk);
      }
      if (record.exit) {
        listener.onExit(record.exit);
      }
      return () => {
        if (record.listener !== listener) {
          return;
        }
        record.listener = null;
        if (record.exit) {
          records.delete(terminalId);
        }
      };
    },
  };

  /**
   * Route one inbound frame.
   * @param raw Decoded bridge message of any type.
   */
  function handleServerMsg(raw: { type: string }): boolean {
    if (!raw.type.startsWith("terminal_")) {
      return false;
    }
    const msg = raw as TerminalServerMsg;
    if (msg.type === "terminal_created" || msg.type === "terminal_list_result") {
      const waiter = pending.get(msg.requestId);
      if (waiter) {
        pending.delete(msg.requestId);
        clock.clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
      return true;
    }
    if (msg.type === "terminal_output") {
      const record = recordFor(msg.terminalId);
      const bytes = decodeBase64Bytes(msg.data);
      if (record.listener) {
        record.listener.onOutput(bytes);
      } else {
        record.backlog.push(bytes);
      }
      return true;
    }
    if (msg.type === "terminal_exit") {
      finish(msg.terminalId, {
        reason: msg.killed ? "killed" : "exited",
        exitCode: msg.exitCode,
      });
      return true;
    }
    if (msg.type === "terminal_error" && msg.terminalId) {
      finish(msg.terminalId, { reason: "error", exitCode: null, message: msg.message });
    }
    return true;
  }

  /**
   * End every running terminal as disconnected and reject pending requests.
   * @param message Reason recorded on each exit.
   */
  function closeAll(message: string): void {
    for (const [requestId, waiter] of pending) {
      clock.clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
      pending.delete(requestId);
    }
    for (const terminalId of [...records.keys()]) {
      finish(terminalId, { reason: "disconnected", exitCode: null, message });
    }
  }

  return { api, handleServerMsg, closeAll };
}
