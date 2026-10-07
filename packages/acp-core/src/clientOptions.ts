/**
 * Constructor options for AcpClient: the transport plus the listener hooks
 * bridges and M0 scripts wire in. Kept apart from the class so the core and
 * the public client can share it without importing each other.
 */

import type { AcpTransport } from "./transport.js";
import type { SessionState, SessionUpdate } from "./types.js";

/**
 * Options accepted by `new AcpClient(...)`.
 * Only `transport` is required; every callback is optional and a missing
 * one simply means that event is not observed.
 */
export type AcpClientOptions = {
  transport: AcpTransport;
  /** Quiet window after prompt response before settling to idle (ms). */
  settleQuietMs?: number;
  /** Auto-respond to permission requests (tests / --always-approve style). */
  autoPermissionOptionId?: string | null;
  onStateChange?: (state: SessionState) => void;
  /**
   * Raw session/update callback for thin-bridge relay (fires even during
   * session/load replay so UIs can reduce without full-state broadcasts).
   * Bridges that batch load windows should gate fan-out via onReplayChange
   * rather than dropping this callback.
   */
  onSessionUpdate?: (
    update: SessionUpdate,
    sessionId: string,
    eventId: string | null,
  ) => void;
  /**
   * Fired when the session/load replay window opens (`on=true`) or closes
   * (`on=false`). sessionId is the current snapshot id (resume id). Bridges
   * use this to emit replay_begin / replay_end and suppress per-update WS
   * fan-out for that session only.
   */
  onReplayChange?: (on: boolean, sessionId: string) => void;
  onStderr?: (line: string) => void;
  /** Called when agent issues reverse requests other than permission (fs/terminal). */
  onAgentRequest?: (
    method: string,
    id: number | string,
    params: unknown,
  ) => unknown | Promise<unknown>;
};
