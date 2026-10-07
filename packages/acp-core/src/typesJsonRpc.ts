/**
 * JSON-RPC 2.0 envelope types plus the handshake / prompt result shapes
 * the ACP client reads back from the agent.
 * Wire-level only: no session or timeline semantics live here.
 */

/** JSON-RPC 2.0 request (client→agent or agent→client). */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

/** JSON-RPC 2.0 success/error response. */
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC 2.0 notification (no id). */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

/**
 * Any decoded JSON-RPC frame. Callers discriminate by `id` / `method`
 * presence (see codec `classifyMessage`), not by a tag field.
 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * `initialize` result as read by the handshake. Every field is optional
 * because agents differ; unknown vendor keys pass through untouched.
 */
export type InitializeResult = {
  protocolVersion?: number | string;
  agentCapabilities?: unknown;
  authMethods?: Array<{ id: string; name?: string }>;
  availableModels?: Array<{ id: string; name?: string }>;
  [key: string]: unknown;
};

/**
 * `session/prompt` result. `stopReason` is absent on agents that omit it;
 * usage counters ride in vendor keys (parsed by sessionTokenUsage).
 */
export type PromptResult = {
  stopReason?: string;
  [key: string]: unknown;
};
