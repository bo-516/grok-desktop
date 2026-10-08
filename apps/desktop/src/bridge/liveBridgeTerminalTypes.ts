/**
 * Wire + client types for the integrated terminal (bridge `terminal_*`
 * protocol, Go side in apps/bridge-go/internal/wsapi/terminal.go).
 * Kept apart from liveBridgeTypes so the shared message union only gains one
 * additive member.
 */

/** Bridge description of one PTY terminal (Go `userterm.Info`). */
export type TerminalInfo = {
  /** Bridge-assigned id (`pty-<n>`); stable for the terminal's lifetime. */
  terminalId: string;
  /** Agent session the terminal is bound to; absent when unbound (draft). */
  sessionId?: string;
  /** Absolute directory the shell started in. */
  cwd: string;
  /** Program path the bridge launched (login shell / pwsh). */
  shell: string;
  /** Shell process id on the bridge host. */
  pid: number;
  /** Current PTY columns. */
  cols: number;
  /** Current PTY rows. */
  rows: number;
};

/** `terminal_*` frames the bridge sends (owner socket only). */
export type TerminalServerMsg =
  | {
      type: "terminal_created";
      requestId: string;
      ok: boolean;
      terminal?: TerminalInfo;
      error?: string;
    }
  | {
      type: "terminal_list_result";
      requestId: string;
      terminals: TerminalInfo[];
    }
  /** PTY output; `data` is base64 of raw bytes (may split UTF-8 sequences). */
  | { type: "terminal_output"; terminalId: string; data: string }
  /** Shell reaped; `exitCode` is -1 when killed by a signal. */
  | {
      type: "terminal_exit";
      terminalId: string;
      exitCode: number;
      killed: boolean;
    }
  /** Op on an unknown / foreign terminal, or a rejected input payload. */
  | { type: "terminal_error"; terminalId?: string; message: string };

/** Why a terminal ended, as seen by the panel. */
export type TerminalExitReason = "exited" | "killed" | "disconnected" | "error";

/** Final state delivered once per terminal to its listener. */
export type TerminalExit = {
  /** What ended the terminal. */
  reason: TerminalExitReason;
  /** Shell exit code; null when unknown (disconnect / bridge error). */
  exitCode: number | null;
  /** Human-readable detail for `disconnected` / `error`. */
  message?: string;
};

/** Per-terminal sink the xterm host registers. */
export type TerminalListener = {
  /**
   * Raw output bytes in arrival order. The listener must call
   * {@link LiveBridgeTerminal.ack} with the byte count once rendered, or the
   * bridge pauses the stream at its credit window.
   */
  onOutput: (bytes: Uint8Array) => void;
  /** Called once when the terminal ends (any reason). */
  onExit: (exit: TerminalExit) => void;
};

/** Options for {@link LiveBridgeTerminal.create}. */
export type TerminalCreateOpts = {
  /** Session to bind (deleting the session kills the terminal). */
  sessionId?: string;
  /** Absolute workspace root; omitted → session workspace / bridge default. */
  cwd?: string;
  /** Initial xterm columns (0 → bridge default 80). */
  cols: number;
  /** Initial xterm rows (0 → bridge default 24). */
  rows: number;
};

/**
 * Terminal API exposed on the live bridge handle. Boolean methods return
 * false when the socket is down (the call is dropped, not queued).
 */
export type LiveBridgeTerminal = {
  /**
   * Start a shell on a new PTY.
   * @returns The bridge's description; rejects with the bridge error text.
   */
  create: (opts: TerminalCreateOpts) => Promise<TerminalInfo>;
  /** Terminals this socket owns (survivors after a UI remount). */
  list: () => Promise<TerminalInfo[]>;
  /** Send text input (xterm onData). Ordered per terminal via `seq`. */
  write: (terminalId: string, data: string) => boolean;
  /** Send binary input (xterm onBinary: one char per byte). */
  writeBinary: (terminalId: string, data: string) => boolean;
  /** Resize the PTY; ordered with input. */
  resize: (terminalId: string, cols: number, rows: number) => boolean;
  /** Return output credit after rendering `bytes`. */
  ack: (terminalId: string, bytes: number) => boolean;
  /** Kill the shell and its process tree. */
  kill: (terminalId: string) => boolean;
  /**
   * Attach the single listener for a terminal. Output / exit that arrived
   * before attaching is replayed immediately.
   * @returns Detach function; detaching after exit forgets the terminal.
   */
  subscribe: (terminalId: string, listener: TerminalListener) => () => void;
};
