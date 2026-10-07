/**
 * Handler-only bridge messages: pool / environment / auth / info / error /
 * stderr / hello / restart_required. These carry no SessionState, so they
 * bypass the reduce buckets and go straight to the matching handler.
 * Replay side effects (error flushing a replay window) stay in the dispatcher.
 */

import type { BridgeServerMsg, LiveBridgeHandlers } from "./liveBridgeTypes";

/**
 * Forward one handler-only message to its callback.
 * Optional handlers that are not wired simply drop the message.
 * @param handlers Connection handler callbacks.
 * @param msg Decoded bridge message of any type.
 * @returns True when `msg` was one of the handler-only types (consumed),
 *   false when the caller should keep routing it (fs / cli / other types).
 */
export function routeBridgeNotice(
  handlers: LiveBridgeHandlers,
  msg: BridgeServerMsg,
): boolean {
  if (msg.type === "pool") {
    handlers.onPool?.(msg.entries);
    return true;
  }
  if (msg.type === "environment") {
    handlers.onEnvironment?.(msg.env);
    return true;
  }
  if (msg.type === "auth_state") {
    handlers.onAuthState?.(msg.auth);
    return true;
  }
  if (msg.type === "info") {
    handlers.onInfo?.(msg.message, msg.sessionId);
    return true;
  }
  if (msg.type === "error") {
    handlers.onError?.(msg.message, msg.sessionId);
    return true;
  }
  if (msg.type === "stderr") {
    handlers.onStderr?.(msg.text, msg.sessionId);
    return true;
  }
  if (msg.type === "hello") {
    handlers.onHello?.(msg.cwd, msg.poolCapacity, {
      impl: msg.impl,
      version: msg.version,
    });
    return true;
  }
  if (msg.type === "restart_required") {
    handlers.onRestartRequired?.(msg);
    return true;
  }
  return false;
}
