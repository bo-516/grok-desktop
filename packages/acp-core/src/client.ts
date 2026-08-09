/**
 * ACP stdio client: handshake, prompt, cancel, permission replies, update dispatch.
 * Transport is injectable so tests/mock/live all share the same production path.
 */

import {
  classifyMessage,
  decodeLine,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from "./codec.js";
import {
  applySessionUpdate,
  createSessionState,
  extractSessionUpdate,
} from "./timeline.js";
import {
  appendUserPrompt,
  buildPermissionOutcome,
  clearPendingPermission,
  markDisconnected,
  markPromptSettled,
  markPromptStarted,
  setPendingPermission,
  shapePermissionRequest,
  tagSeedUserMessages,
} from "./sessionLifecycle.js";
import {
  extractAvailableModelsFromSessionResult,
  extractInitializeSessionMetadata,
  extractModelFromSessionResult,
  preferCommands,
  resolveAvailableModels,
  resolveReverseErrorCode,
} from "./sessionMetadata.js";
import type { AcpTransport } from "./transport.js";
import type {
  ContentBlock,
  InitializeResult,
  JsonRpcMessage,
  PromptResult,
  SessionState,
} from "./types.js";

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
    const init = (await this.request("initialize", {
      protocolVersion: opts.protocolVersion ?? 1,
      clientCapabilities: opts.clientCapabilities ?? {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
      },
    })) as InitializeResult;
    const initialMetadata = extractInitializeSessionMetadata(init);
    /** Captured for every subsequent setState so image gates stay available (F-STREAM-07). */
    const agentCapabilities = init.agentCapabilities;

    const methods = new Set(
      (init.authMethods ?? []).map((m) => m.id).filter(Boolean),
    );
    let methodId = opts.authMethodId ?? null;
    if (!methodId) {
      if (opts.envApiKeyPresent && methods.has("xai.api_key")) {
        methodId = "xai.api_key";
      } else if (methods.has("cached_token")) {
        methodId = "cached_token";
      } else if (methods.size > 0) {
        methodId = [...methods][0] ?? null;
      }
    }
    if (methodId) {
      await this.request("authenticate", {
        methodId,
        _meta: { headless: true },
      });
    }

    const model = initialMetadata.model;
    /** Prefer session-scoped catalog when present; otherwise initialize's agent list. */
    const modelsFromInit = initialMetadata.availableModels;

    if (opts.resumeId) {
      // Show cached transcript immediately, then agent replays on top.
      // Tag seed user rows so user_message_chunk replay confirms by identity
      // instead of concatenating the same body twice.
      if (opts.seed && opts.seed.id === opts.resumeId) {
        this.setState({
          ...opts.seed,
          timeline: tagSeedUserMessages(opts.seed.timeline),
          workspace: opts.cwd || opts.seed.workspace,
          model: opts.seed.model || String(model),
          availableCommands: preferCommands(
            opts.seed.availableCommands,
            initialMetadata.availableCommands,
          ),
          availableModels:
            (opts.seed.availableModels && opts.seed.availableModels.length > 0
              ? opts.seed.availableModels
              : undefined) ?? modelsFromInit,
          agentCapabilities:
            opts.seed.agentCapabilities ?? agentCapabilities,
          status: "idle",
          pendingPermission: undefined,
        });
      } else {
        this.setState({
          ...createSessionState({
            id: opts.resumeId,
            workspace: opts.cwd,
            model: String(model),
            mode: "build",
          }),
          availableCommands: initialMetadata.availableCommands,
          availableModels: modelsFromInit,
          agentCapabilities,
        });
      }
      // grok-build requires session/load to include both cwd and mcpServers; missing either is Invalid params.
      const loadResult = await this.request("session/load", {
        sessionId: opts.resumeId,
        cwd: opts.cwd,
        mcpServers: opts.mcpServers ?? [],
      });
      const loadedModel = extractModelFromSessionResult(loadResult) || model;
      const loadedModels = extractAvailableModelsFromSessionResult(loadResult);
      // Keep id stable; replay / available_commands_update may have already populated fields.
      const cur = this.getSessionState();
      this.setState({
        ...cur,
        id: opts.resumeId,
        workspace: opts.cwd || cur.workspace,
        model: cur.model || String(loadedModel),
        availableCommands: preferCommands(
          cur.availableCommands,
          initialMetadata.availableCommands,
        ),
        availableModels: resolveAvailableModels(
          loadedModels,
          cur.availableModels,
          modelsFromInit,
        ),
        agentCapabilities: cur.agentCapabilities ?? agentCapabilities,
        status: cur.status === "disconnected" ? "idle" : cur.status,
        errorMessage: undefined,
      });
      return { init, sessionId: opts.resumeId, resumed: true };
    }

    const session = (await this.request("session/new", {
      cwd: opts.cwd,
      mcpServers: opts.mcpServers ?? [],
    })) as { sessionId?: string };

    const sessionId = session.sessionId ?? "";
    if (!sessionId) {
      throw new Error("session/new did not return sessionId");
    }

    const newModel = extractModelFromSessionResult(session) || model;
    const sessionModels = extractAvailableModelsFromSessionResult(session);
    /**
     * session/new may emit available_commands_update / current_mode_update while the RPC
     * is in flight. Merge those into the post-handshake snapshot instead of wiping them
     * with a blank createSessionState().
     */
    const interim = this.getSessionState();
    this.setState({
      ...createSessionState({
        id: sessionId,
        workspace: opts.cwd,
        model: String(newModel),
        mode: interim.mode || "build",
      }),
      availableCommands: preferCommands(
        interim.availableCommands,
        initialMetadata.availableCommands,
      ),
      availableModels:
        sessionModels.length > 0 ? sessionModels : modelsFromInit,
      agentCapabilities,
      configOptions: interim.configOptions,
      title: interim.title,
    });

    return { init, sessionId, resumed: false };
  }

  /**
   * Replace session snapshot (used when bridge seeds cache before replay).
   */
  replaceSessionState(state: SessionState): void {
    this.setState(state);
  }

  /**
   * Send a user prompt and wait for the PromptResponse.
   * Streaming updates are applied as they arrive via handleLine.
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
    if (this.settleTimer) {clearTimeout(this.settleTimer);}
    this.transport.dispose?.();
  }

  // --- internals ---

  private setState(next: SessionState): void {
    this.state = next;
    this.onStateChange?.(next);
  }

  private scheduleSettle(): void {
    if (this.settleTimer) {clearTimeout(this.settleTimer);}
    this.settleTimer = setTimeout(() => {
      if (this.promptInFlight) {return;}
      if (this.state.status === "waiting_permission") {return;}
      if (this.state.status === "disconnected") {return;}
      this.setState(markPromptSettled(this.state));
    }, this.settleQuietMs);
  }

  private handleLine(line: string): void {
    const decoded = decodeLine(line);
    if (!decoded.ok) {return;}
    this.dispatchMessage(decoded.message);
  }

  /**
   * Public for tests: feed a fully decoded JSON-RPC message through the same path.
   */
  dispatchMessage(message: JsonRpcMessage): void {
    const kind = classifyMessage(message);

    if (kind.kind === "response") {
      if (kind.id === null || kind.id === undefined) {return;}
      const waiter = this.pending.get(kind.id);
      if (!waiter) {return;}
      this.pending.delete(kind.id);
      if (kind.error) {
        waiter.reject(
          new Error(kind.error.message || `RPC error ${kind.error.code}`),
        );
      } else {
        waiter.resolve(kind.result);
      }
      return;
    }

    if (kind.kind === "notification") {
      if (kind.method === "session/update") {
        const update = extractSessionUpdate(kind.params);
        if (update) {
          this.setState(applySessionUpdate(this.state, update));
          // activity delays settle
          if (this.promptInFlight || this.state.status === "streaming") {
            this.scheduleSettle();
          }
        }
      }
      return;
    }

    if (kind.kind === "request") {
      void this.handleIncomingRequest(kind.id, kind.method, kind.params);
    }
  }

  private async handleIncomingRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    if (method === "session/request_permission") {
      const shaped = shapePermissionRequest(id, params);
      this.setState(setPendingPermission(this.state, shaped));
      if (this.autoPermissionOptionId) {
        this.respondPermission(this.autoPermissionOptionId);
      }
      return;
    }

    // Reverse handlers (fs/terminal/…). Must return real errors — never silent {}.
    if (this.onAgentRequest) {
      try {
        const result = await this.onAgentRequest(method, id, params);
        this.transport.write(encodeResponse(id, result ?? {}));
      } catch (e) {
        const code =
          e &&
          typeof e === "object" &&
          "code" in e &&
          typeof (e as { code: unknown }).code === "number"
            ? (e as { code: number }).code
            : -32000;
        const msg = e instanceof Error ? e.message : String(e);
        // Prefer -32601 when handler signals method-not-found (message or code).
        const rpcCode = resolveReverseErrorCode(code, msg);
        this.transport.write(
          encodeResponse(id, undefined, {
            code: rpcCode,
            message: msg.includes(String(method))
              ? msg
              : `${msg} (${method})`,
          }),
        );
      }
      return;
    }

    this.transport.write(
      encodeResponse(id, undefined, {
        code: -32601,
        message: `Method not found: ${method}`,
      }),
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
