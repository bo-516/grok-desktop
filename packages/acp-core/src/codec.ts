/**
 * NDJSON JSON-RPC 2.0 codec for ACP over stdio.
 * Framing: one JSON object per line, no Content-Length headers.
 */

import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

/** Encode a JSON-RPC message as a single NDJSON line (includes trailing newline). */
export function encodeMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Build a JSON-RPC request.
 * @param id Request id used for response pairing
 * @param method RPC method name
 * @param params Optional params object
 */
export function encodeRequest(
  id: number | string,
  method: string,
  params?: unknown,
): string {
  const req: JsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return encodeMessage(req);
}

/**
 * Build a JSON-RPC notification (no id, no response expected).
 */
export function encodeNotification(method: string, params?: unknown): string {
  const n: JsonRpcNotification = {
    jsonrpc: "2.0",
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return encodeMessage(n);
}

/**
 * Build a JSON-RPC response (for agent→client reverse requests such as permission).
 */
export function encodeResponse(
  id: number | string,
  result?: unknown,
  error?: { code: number; message: string; data?: unknown },
): string {
  const res: JsonRpcResponse = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result: result ?? {} };
  return encodeMessage(res);
}

export type DecodeResult =
  | { ok: true; message: JsonRpcMessage }
  | { ok: false; error: string; raw: string };

/**
 * Parse one NDJSON line into a JSON-RPC message.
 * Non-JSON lines return ok:false (tolerant — never throw for agent noise).
 */
export function decodeLine(line: string): DecodeResult {
  const raw = line.trim();
  if (!raw) {
    return { ok: false, error: "empty line", raw: line };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON", raw: line };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "message is not an object", raw: line };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0" && obj.jsonrpc !== undefined) {
    // Some agents omit jsonrpc; still accept if method/id present
  }
  return { ok: true, message: parsed as JsonRpcMessage };
}

/**
 * Classify a decoded message into request / response / notification.
 * Agent→client reverse calls have both id and method.
 */
export type MessageKind =
  | { kind: "request"; id: number | string; method: string; params?: unknown }
  | { kind: "response"; id: number | string | null; result?: unknown; error?: JsonRpcResponse["error"] }
  | { kind: "notification"; method: string; params?: unknown }
  | { kind: "unknown"; message: JsonRpcMessage };

export function classifyMessage(message: JsonRpcMessage): MessageKind {
  const m = message as Record<string, unknown>;
  const hasId = Object.prototype.hasOwnProperty.call(m, "id") && m.id !== undefined;
  const method = typeof m.method === "string" ? m.method : undefined;

  if (hasId && method) {
    return {
      kind: "request",
      id: m.id as number | string,
      method,
      params: m.params,
    };
  }
  if (hasId && !method) {
    return {
      kind: "response",
      id: m.id as number | string | null,
      result: m.result,
      error: m.error as JsonRpcResponse["error"],
    };
  }
  if (!hasId && method) {
    return {
      kind: "notification",
      method,
      params: m.params,
    };
  }
  return { kind: "unknown", message };
}

/**
 * Split a buffer of incomplete stdout into complete lines + remainder.
 * Used by streaming stdio readers.
 */
export function splitNdjsonBuffer(buffer: string): {
  lines: string[];
  rest: string;
} {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.filter((l) => l.length > 0);
  return { lines, rest };
}
