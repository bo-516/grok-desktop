/**
 * @grok-desktop/acp-core public API.
 * Pure protocol + session timeline logic for M0 scripts and the desktop UI.
 */

export * from "./types.js";
export * from "./codec.js";
export * from "./timeline.js";
export * from "./sessionLifecycle.js";
export * from "./sessionMetadata.js";
export * from "./transport.js";
export * from "./client.js";
export * from "./mockAgent.js";
export * from "./sessionTitle.js";
export * from "./sessionFork.js";
export * from "./eventIdDedupe.js";
export {
  dispatchAcpMessage,
  isSessionUpdateMethod,
  type DispatchHost,
} from "./clientDispatch.js";
