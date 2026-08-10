/**
 * ACP stdio client: handshake, prompt, cancel, permission replies, update dispatch.
 * Transport is injectable so tests/mock/live all share the same production path.
 * Handshake and inbound dispatch live in clientHandshake / clientDispatch.
 */

import {
  decodeLine,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from "./codec.js";
import { createSessionState } from "./timeline.js";
import {
  appendUserPrompt,
  buildPermissionOutcome,
  clearPendingPermission,
  markDisconnected,
  markPromptSettled,
  markPromptStarted,
} from "./sessionLifecycle.js";
import type { AcpTransport } from "./transport.js";
import type {
  ContentBlock,
  InitializeResult,
  JsonRpcMessage,
  PromptResult,
  SessionState,
} from "./types.js";
import { runAcpHandshake } from "./clientHandshake.js";
import { dispatchAcpMessage } from "./clientDispatch.js";

export type { AcpTransport } from "./transport.js";

export type AcpClientOptions = {
  transport: AcpTransport;
  /** Quiet window after prompt response before settling to idle (ms). */
  settleQuietMs?: number;
  /** Auto-respond to permission requests (tests / --always-approve style). */
  autoPermissionOptionId?: string | null;
  onStateChange?: (state: SessionState) => void;
  onStderr?: (line: string) => void;
  /** Called when agent issues reverse requests other than permission (fs/terminal). */
  onAgentRequest?: (
    method: string,
    id: number | string,
    params: unknown,
  ) => unknown | Promise<unknown>;
};

/**
 * Production ACP client used by M0 scripts and (via bridge) the desktop UI.
 */
export class AcpClient {
  private readonly transport: AcpTransport;
  private readonly settleQuietMs: number;
  private readonly autoPermissionOptionId: string | null;
  private readonly onStateChange?: (state: SessionState) => void;
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
  private state: SessionState;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private promptInFlight = false;
  private disposed = false;
  /**
   * True while a `session/load` replay is in flight. The snapshot still absorbs
   * every replayed chunk, but listeners are not notified until the window
   * closes, so restoring history costs one repaint instead of one per chunk
   * and the UI never mistakes replayed history for a live turn.
   */
  private replaying = false;

  constructor(opts: AcpClientOptions) {
    this.transport = opts.transport;
    this.settleQuietMs = opts.settleQuietMs ?? 200;
    this.autoPermissionOptionId =
      opts.autoPermissionOptionId === undefined
        ? null
        : opts.autoPermissionOptionId;
    this.onStateChange = opts.onStateChange;
    this.onStderr = opts.onStderr;
    this.onAgentRequest = opts.onAgentRequest;
    this.state = createSessionState({ id: "", workspace: "" });

    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onClose?.(() => {
      // A transport death during replay must reach listeners; the pending
      // session/load can never flush, so drop the gate before the paint.
      this.replaying = false;
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
   * Run initialize → authenticate → session/new | session/load, and prefill model and commands from grok-build metadata.
   * @param opts Workspace, auth, and optional resume snapshot; a bad resumeId yields an agent RPC error and is handled by the existing retry policy.
   * @returns Initialize result, stable session id, and whether the resume path was used; body text still arrives via session/update streaming.
   */
  async handshake(opts: {
    cwd: string;
    protocolVersion?: number;
    mcpServers?: unknown[];
    clientCapabilities?: unknown;
    authMethodId?: string | null;
    envApiKeyPresent?: boolean;
    /** Existing ACP session id to resume via session/load. */
    resumeId?: string;
    /** Local cached state to show while load/replay is in flight. */
    seed?: SessionState;
  }): Promise<{ init: InitializeResult; sessionId: string; resumed: boolean }> {
    return runAcpHandshake(
      {
        request: (method, params) => this.request(method, params),
        getSessionState: () => this.getSessionState(),
        replaceSessionState: (state) => this.replaceSessionState(state),
        setReplaying: (on) => this.setReplaying(on),
      },
      opts,
    );
  }

  /**
   * Replace session snapshot (used when bridge seeds cache before replay).
   * @param state Next SessionState (not mutated in place by the client).
   */
  replaceSessionState(state: SessionState): void {
    this.setState(state);
  }

  /**
   * Open or close the `session/load` replay window.
   * While open, replayed chunks mutate the snapshot silently; closing emits
   * exactly one state carrying the finished transcript. Callers must always
   * close the window they opened (including on RPC failure), otherwise the
   * session goes mute and no later live update ever reaches the UI.
   * @param on True to suppress per-chunk fan-out, false to close and flush once.
   */
  setReplaying(on: boolean): void {
    if (this.replaying === on) {
      return;
    }
    this.replaying = on;
    if (on) {
      return;
    }
    // Replay leaves no live turn behind: drop the pending settle so it cannot
    // fire a second full-timeline repaint right after the flush.
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.onStateChange?.(this.state);
  }

  /**
   * Send a user prompt and wait for the PromptResponse.
   * Streaming updates are applied as they arrive via handleLine.
   * @param sessionId Active ACP session id.
   * @param blocks Prompt content blocks (text / image / resource_link).
   * @returns PromptResult from the agent; throws on RPC error.
   */
  async prompt(
    sessionId: string,
    blocks: ContentBlock[],
  ): Promise<PromptResult> {
    this.setState(appendUserPrompt(this.state, blocks));
    this.setState(markPromptStarted(this.state));
    this.promptInFlight = true;
    try {
      const result = (await this.request("session/prompt", {
        sessionId,
        prompt: blocks,
      })) as PromptResult;
      this.promptInFlight = false;
      this.scheduleSettle();
      return result;
    } catch (e) {
      this.promptInFlight = false;
      this.setState(markPromptSettled(this.state));
      throw e;
    }
  }

  /** Cancel the current turn (notification; late updates may still arrive). */
  cancel(sessionId: string): void {
    this.transport.write(
      encodeNotification("session/cancel", { sessionId }),
    );
    this.scheduleSettle();
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

  dispose(): void {
    this.disposed = true;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    this.transport.dispose?.();
  }

  // --- internals ---

  private setState(next: SessionState): void {
    this.state = next;
    if (this.replaying) {
      // Coalesced into the single flush in setReplaying(false).
      return;
    }
    this.onStateChange?.(next);
  }

  private scheduleSettle(): void {
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
        scheduleSettle: () => this.scheduleSettle(),
        isPromptInFlight: () => this.promptInFlight,
        autoPermissionOptionId: this.autoPermissionOptionId,
        respondPermission: (optionId) => this.respondPermission(optionId),
        onAgentRequest: this.onAgentRequest,
      },
      message,
    );
  }

  /**
   * Mid-session model switch via `session/set_model` when the agent supports it.
   * @param sessionId Active ACP session id.
   * @param modelId Agent-declared model id (never a desktop hardcode).
   * @returns Agent result; throws on RPC error (including -32601 when unsupported).
   */
  async setModel(sessionId: string, modelId: string): Promise<unknown> {
    const result = await this.request("session/set_model", {
      sessionId,
      modelId,
    });
    const cur = this.getSessionState();
    this.setState({ ...cur, model: modelId.trim() || cur.model });
    return result;
  }

  /**
   * Mid-session mode switch via `session/set_mode` when the agent supports it.
   * @param sessionId Active ACP session id.
   * @param modeId Agent mode id (e.g. plan / build); product maps UI chips to these ids.
   * @returns Agent result; throws on RPC error.
   */
  async setMode(sessionId: string, modeId: string): Promise<unknown> {
    const result = await this.request("session/set_mode", {
      sessionId,
      modeId,
    });
    const cur = this.getSessionState();
    const mapped =
      modeId === "ask" || modeId === "plan" || modeId === "build"
        ? modeId
        : cur.mode;
    this.setState({ ...cur, mode: mapped });
    return result;
  }

  /**
   * Request context compact when agent exposes `session/compact`.
   * @param sessionId Active session.
   * @param instruction Optional retention hint for the compressor.
   */
  async compact(sessionId: string, instruction?: string): Promise<unknown> {
    return this.request("session/compact", {
      sessionId,
      ...(instruction ? { instruction } : {}),
    });
  }

  /**
   * Query token usage when agent exposes `session/token_usage`.
   * @param sessionId Active session.
   */
  async tokenUsage(sessionId: string): Promise<unknown> {
    return this.request("session/token_usage", { sessionId });
  }
}
