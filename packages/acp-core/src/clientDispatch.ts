/**
 * ACP inbound message dispatch: JSON-RPC responses, session/update, reverse requests.
 * Extracted from AcpClient for file-size; uses a thin host surface.
 */

import {
  classifyMessage,
  encodeResponse,
} from "./codec.js";
import {
  applySessionUpdate,
  extractSessionUpdate,
} from "./timeline.js";
import { extractEventId } from "./eventIdDedupe.js";
import {
  setPendingPermission,
  shapePermissionRequest,
} from "./sessionLifecycle.js";
import { resolveReverseErrorCode } from "./sessionMetadata.js";
import type { JsonRpcMessage, SessionState, SessionUpdate } from "./types.js";

/** Vendor namespace grok-build uses for non-standard session notifications. */
const XAI_METHOD_PREFIX = "_x.ai/";

/**
 * Whether a notification method carries an ACP session update payload.
 *
 * grok-build reports orchestration (goal / subagent / background task / retry)
 * under `_x.ai/session/update`. The params shape is identical to the standard
 * method — `{ sessionId, update, _meta }` — so both names must feed the same
 * reducer and the same settle bookkeeping. Routing the vendor method through a
 * second path would fork `status` / `scheduleSettle` and desynchronize the canvas.
 * @param method Raw JSON-RPC notification method name.
 * @returns True when params should go through extractSessionUpdate.
 */
export function isSessionUpdateMethod(method: string): boolean {
  return (
    method === "session/update" ||
    method === `${XAI_METHOD_PREFIX}session/update`
  );
}

/** Host surface dispatch needs from AcpClient. */
export type DispatchHost = {
  /** Pending RPC waiters keyed by id. */
  pending: Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >;
  /** Current session snapshot. */
  getSessionState: () => SessionState;
  /** Replace session snapshot and notify listeners. */
  replaceSessionState: (state: SessionState) => void;
  /** Write a transport line. */
  write: (line: string) => void;
  /** Quiet settle after streaming activity. */
  scheduleSettle: () => void;
  /** Whether a prompt RPC is in flight. */
  isPromptInFlight: () => boolean;
  /** Auto-respond option id, or null. */
  autoPermissionOptionId: string | null;
  /** Respond to pending permission (used by auto-approve). */
  respondPermission: (optionId: string) => void;
  /**
   * Optional raw session/update fan-out for thin bridges (relay mode).
   * Fired for every accepted update including during session/load replay so
   * clients can rebuild SessionState without full-state broadcasts.
   */
  onSessionUpdate?: (
    update: SessionUpdate,
    sessionId: string,
    eventId: string | null,
  ) => void;
  /**
   * Optional eventId set-dedupe gate (bridge AcpClient).
   * Return false to skip apply + relay for a redelivered id.
   * When omitted, every update is applied (tests / bare hosts).
   */
  acceptEventId?: (eventId: string | null) => boolean;
  /** Reverse fs/terminal handlers from the bridge. */
  onAgentRequest?: (
    method: string,
    id: number | string,
    params: unknown,
  ) => unknown | Promise<unknown>;
};

/**
 * Feed a fully decoded JSON-RPC message through the production path.
 * @param host AcpClient surface for pending map, state, transport.
 * @param message Decoded JSON-RPC message (response / notification / request).
 */
export function dispatchAcpMessage(
  host: DispatchHost,
  message: JsonRpcMessage,
): void {
  const kind = classifyMessage(message);

  if (kind.kind === "response") {
    if (kind.id === null || kind.id === undefined) {
      return;
    }
    const waiter = host.pending.get(kind.id);
    if (!waiter) {
      return;
    }
    host.pending.delete(kind.id);
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
    if (isSessionUpdateMethod(kind.method)) {
      const update = extractSessionUpdate(kind.params);
      if (update) {
        const eventId = extractEventId(kind.params);
        // Bridge source of truth must not double-apply redelivered eventIds;
        // desktop reduce has its own ring, but hydrate can re-import a corrupt
        // bridge snapshot if we skip dedupe here.
        if (host.acceptEventId && !host.acceptEventId(eventId)) {
          return;
        }
        const sessionId =
          kind.params &&
          typeof kind.params === "object" &&
          typeof (kind.params as { sessionId?: unknown }).sessionId === "string"
            ? (kind.params as { sessionId: string }).sessionId
            : host.getSessionState().id;
        // Relay listeners see the raw update even while AcpClient is replaying
        // (session/load); state fan-out remains gated by setReplaying.
        host.onSessionUpdate?.(update, sessionId, eventId);
        host.replaceSessionState(
          applySessionUpdate(host.getSessionState(), update),
        );
        // activity delays settle
        if (
          host.isPromptInFlight() ||
          host.getSessionState().status === "streaming"
        ) {
          host.scheduleSettle();
        }
      }
    }
    return;
  }

  if (kind.kind === "request") {
    void handleIncomingRequest(host, kind.id, kind.method, kind.params);
  }
}

/**
 * Handle agent→client reverse requests (permission + fs/terminal).
 * @param host Dispatch host.
 * @param id JSON-RPC id.
 * @param method Method name.
 * @param params Method params.
 */
async function handleIncomingRequest(
  host: DispatchHost,
  id: number | string,
  method: string,
  params: unknown,
): Promise<void> {
  if (method === "session/request_permission") {
    const shaped = shapePermissionRequest(id, params);
    host.replaceSessionState(
      setPendingPermission(host.getSessionState(), shaped),
    );
    if (host.autoPermissionOptionId) {
      host.respondPermission(host.autoPermissionOptionId);
    }
    return;
  }

  // Reverse handlers (fs/terminal/…). Must return real errors — never silent {}.
  if (host.onAgentRequest) {
    try {
      const result = await host.onAgentRequest(method, id, params);
      host.write(encodeResponse(id, result ?? {}));
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
      host.write(
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

  host.write(
    encodeResponse(id, undefined, {
      code: -32601,
      message: `Method not found: ${method}`,
    }),
  );
}
