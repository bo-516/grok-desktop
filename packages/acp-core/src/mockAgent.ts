/**
 * Local mock ACP agent over an in-process duplex transport.
 * Speaks the same NDJSON JSON-RPC surface as `grok agent stdio` for M0 gating
 * when the live CLI is unavailable.
 */

import {
  classifyMessage,
  decodeLine,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from "./codec.js";
import type { AcpTransport } from "./transport.js";
import type { JsonRpcMessage } from "./types.js";

export type MockAgentOptions = {
  /** If true, emit a permission request mid-prompt that the client must answer. */
  emitPermission?: boolean;
  /** Delay between stream chunks (ms). */
  chunkDelayMs?: number;
  /**
   * Turns replayed as `session/update` before `session/load` answers, matching
   * the ACP rule that history is streamed ahead of the response. 0 (default)
   * keeps the historical no-replay behaviour for tests that only check params.
   */
  loadReplayTurns?: number;
};

/**
 * In-memory linked pair of transports (client side returned; agent runs internally).
 */
export function createMockAcpPair(opts: MockAgentOptions = {}): {
  clientTransport: AcpTransport;
  /** Wait until the mock has finished handling the last prompt stream. */
  whenIdle: () => Promise<void>;
  dispose: () => void;
} {
  const chunkDelayMs = opts.chunkDelayMs ?? 5;
  const emitPermission = opts.emitPermission ?? true;
  const loadReplayTurns = Math.max(0, opts.loadReplayTurns ?? 0);

  type Handler = (line: string) => void;
  let clientLineHandler: Handler | null = null;
  let clientCloseHandler: ((code: number | null) => void) | null = null;
  let closed = false;
  let idleResolve: (() => void) | null = null;
  let idlePromise: Promise<void> = Promise.resolve();
  let sessionCounter = 0;
  let nextAgentReqId = 9000;

  const bumpIdle = (): void => {
    idlePromise = new Promise<void>((r) => {
      idleResolve = r;
    });
  };

  const finishIdle = (): void => {
    idleResolve?.();
    idleResolve = null;
  };

  const toClient = (msg: JsonRpcMessage): void => {
    if (closed) {return;}
    const line = JSON.stringify(msg);
    // Deliver asynchronously to mimic stdio
    queueMicrotask(() => clientLineHandler?.(line));
  };

  const sleep = (ms: number) =>
    new Promise<void>((r) => setTimeout(r, ms));

  /**
   * Stream `loadReplayTurns` finished turns the way a real agent replays
   * history: user echo, reasoning, one tool call, then the answer.
   * @param sessionId Session being loaded; a missing id still emits, letting
   *   tests observe that the client ignores updates for unknown sessions.
   * @returns Resolves once every replayed chunk has been written.
   */
  const replayHistory = async (sessionId?: string): Promise<void> => {
    for (let turn = 1; turn <= loadReplayTurns; turn += 1) {
      const toolCallId = `tool-replay-${turn}`;
      const updates = [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: `question ${turn}` },
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: `recalling step ${turn}… ` },
        },
        {
          sessionUpdate: "tool_call",
          toolCallId,
          title: `read file-${turn}.ts`,
          kind: "read",
          status: "completed",
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `answer ${turn}` },
        },
      ];
      for (const update of updates) {
        toClient({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId, update },
        });
        await sleep(chunkDelayMs);
      }
    }
  };

  const handleClientLine = async (line: string): Promise<void> => {
    const decoded = decodeLine(line);
    if (!decoded.ok) {return;}
    const kind = classifyMessage(decoded.message);

    if (kind.kind === "response") {
      // Client answered our permission request — nothing else to do
      return;
    }

    if (kind.kind === "notification") {
      if (kind.method === "session/cancel") {
        // stop quietly
      }
      return;
    }

    if (kind.kind !== "request") {return;}

    const { id, method, params } = kind;

    if (method === "initialize") {
      toClient({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: [
            { id: "cached_token", name: "Cached token" },
            { id: "xai.api_key", name: "API key" },
          ],
          availableModels: [
            { id: "grok-mock", name: "Grok Mock" },
          ],
        },
      });
      return;
    }

    if (method === "authenticate") {
      toClient({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "session/new") {
      sessionCounter += 1;
      const sessionId = `mock-session-${sessionCounter}`;
      toClient({
        jsonrpc: "2.0",
        id,
        result: {
          sessionId,
          models: {
            currentModelId: "grok-mock",
            availableModels: [{ modelId: "grok-mock", name: "Grok Mock" }],
          },
        },
      });
      return;
    }

    if (method === "session/load") {
      const p = (params ?? {}) as {
        sessionId?: string;
        cwd?: string;
        mcpServers?: unknown[];
      };
      // Align with real grok-build: cwd + mcpServers are required
      if (!p.sessionId || !p.cwd || !Array.isArray(p.mcpServers)) {
        toClient({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Invalid params",
            data: "session/load requires sessionId, cwd, mcpServers",
          },
        });
        return;
      }
      // ACP contract: the whole transcript is replayed before the response.
      await replayHistory(p.sessionId);
      toClient({
        jsonrpc: "2.0",
        id,
        result: {
          models: {
            currentModelId: "grok-mock",
            availableModels: [{ modelId: "grok-mock", name: "Grok Mock" }],
          },
        },
      });
      return;
    }

    if (method === "session/prompt") {
      bumpIdle();
      const p = (params ?? {}) as {
        sessionId?: string;
        prompt?: Array<{ type?: string; text?: string }>;
      };
      const userText =
        p.prompt
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("") ?? "";

      // Thought
      toClient({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Considering the request… " },
          },
        },
      });
      await sleep(chunkDelayMs);

      // Plan
      toClient({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "Read context", status: "completed" },
              { content: "Draft answer", status: "in_progress" },
            ],
          },
        },
      });
      await sleep(chunkDelayMs);

      // Tool call with content
      const toolCallId = "tool-mock-1";
      toClient({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: "read README.md",
            kind: "read",
            status: "pending",
            content: {
              type: "content",
              content: [{ type: "text", text: "README preview" }],
            },
          },
        },
      });
      await sleep(chunkDelayMs);

      // Status-only update (must not wipe content)
      toClient({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
          },
        },
      });
      await sleep(chunkDelayMs);

      if (emitPermission) {
        const permId = nextAgentReqId++;
        toClient({
          jsonrpc: "2.0",
          id: permId,
          method: "session/request_permission",
          params: {
            sessionId: p.sessionId,
            toolCall: {
              toolCallId: "tool-mock-edit",
              title: "write demo.txt",
              kind: "edit",
            },
            options: [
              { optionId: "allow_once", name: "Allow once" },
              { optionId: "allow_always", name: "Always allow" },
              { optionId: "deny", name: "Deny" },
              { optionId: "deny_and_stop", name: "Deny and stop" },
            ],
          },
        });
        // Wait briefly for client auto/manual response; continue either way
        await sleep(chunkDelayMs * 4);
      }

      // Agent message chunks
      const reply = `Mock agent received: ${userText || "(empty)"}`;
      for (const part of chunkString(reply, 12)) {
        toClient({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: p.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: part },
            },
          },
        });
        await sleep(chunkDelayMs);
      }

      toClient({
        jsonrpc: "2.0",
        id,
        result: { stopReason: "end_turn" },
      });
      finishIdle();
      return;
    }

    toClient({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `mock: method not found ${method}` },
    });
  };

  const clientTransport: AcpTransport = {
    write: (data: string) => {
      // data may contain multiple lines
      for (const line of data.split("\n")) {
        if (!line.trim()) {continue;}
        void handleClientLine(line);
      }
    },
    onLine: (handler) => {
      clientLineHandler = handler;
    },
    onClose: (handler) => {
      clientCloseHandler = handler;
    },
    dispose: () => {
      closed = true;
      clientCloseHandler?.(0);
    },
  };

  return {
    clientTransport,
    whenIdle: () => idlePromise,
    dispose: () => clientTransport.dispose?.(),
  };
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    out.push(s.slice(i, i + size));
  }
  return out.length ? out : [""];
}

// Re-export encode helpers used by external mock process script
export { encodeNotification, encodeRequest, encodeResponse, decodeLine };
