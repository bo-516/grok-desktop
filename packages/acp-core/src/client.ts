/**
 * ACP stdio client: handshake, prompt, cancel, permission replies, update dispatch.
 * Transport is injectable so tests/mock/live all share the same production path.
 * Handshake and inbound dispatch live in clientHandshake / clientDispatch;
 * transport wiring, request pairing, replay and settle live in clientCore.
 * This module adds the session-level request operations on top.
 */

import {
  appendUserPrompt,
  markPromptSettled,
  markPromptStarted,
} from "./sessionLifecycle.js";
import {
  parsePromptResultUsage,
  turnCompletedUpdateFromUsage,
} from "./sessionTokenUsage.js";
import type {
  ContentBlock,
  InitializeResult,
  PromptResult,
  SessionState,
  SessionUpdate,
} from "./types.js";
import { runAcpHandshake } from "./clientHandshake.js";
import { AcpClientCore } from "./clientCore.js";

export type { AcpTransport } from "./transport.js";
export type { AcpClientOptions } from "./clientOptions.js";

/**
 * Production ACP client used by M0 scripts and (via bridge) the desktop UI.
 * Construct with AcpClientOptions (inherited constructor); declares no
 * class fields so the core's transport wiring is never re-initialized.
 */
export class AcpClient extends AcpClientCore {
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
    this.promptOriginated = true;
    try {
      const result = (await this.request("session/prompt", {
        sessionId,
        prompt: blocks,
      })) as PromptResult;
      this.promptInFlight = false;
      // F-CTX-01: grok-build always returns counters on prompt result _meta.
      // Vendor turn_completed may be disk-only; relay result usage so the UI
      // ring fills after the first reply without waiting for a stream event.
      this.applyPromptResultUsage(sessionId, result);
      this.scheduleSettle();
      return result;
    } catch (e) {
      this.promptInFlight = false;
      this.setState(markPromptSettled(this.state));
      throw e;
    }
  }

  /**
   * Apply session/prompt result usage into tokenUsage and fan out a synthetic
   * turn_completed so thin bridges relay the same shape as the vendor stream.
   * No-op when counters are missing or unparseable.
   * @param sessionId Active ACP session id for the onSessionUpdate relay.
   * @param result Raw session/prompt result (expects `_meta` usage bag).
   */
  private applyPromptResultUsage(sessionId: string, result: unknown): void {
    const usage = parsePromptResultUsage(result);
    if (!usage) {
      return;
    }
    this.setState({ ...this.state, tokenUsage: usage });
    // Relay as turn_completed so desktop reduce (session_update path) stores it.
    // Idempotent with a real stream turn_completed for the same turn.
    const update = turnCompletedUpdateFromUsage(
      usage,
    ) as unknown as SessionUpdate;
    this.onSessionUpdate?.(update, sessionId, null);
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

  /**
   * Branch the source session into a peer via `_x.ai/session/fork`.
   * Copies history on disk and returns the child id; the client must then
   * `session/load` (or select) that id — this process stays on the parent.
   * @param params sourceSessionId + sourceCwd + newCwd (same cwd for non-worktree).
   * @returns Raw agent result (use parseSessionForkResult for the child id).
   */
  async forkSession(params: {
    sourceSessionId: string;
    sourceCwd: string;
    newCwd: string;
  }): Promise<unknown> {
    return this.request("_x.ai/session/fork", {
      sourceSessionId: params.sourceSessionId,
      sourceCwd: params.sourceCwd,
      newCwd: params.newCwd,
    });
  }
}
