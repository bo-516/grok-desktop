/**
 * Canvas pinning and optimistic-bubble rollback for a background mode switch.
 * Kept separate from the RPC gate so neither file crosses the line cap.
 * Inbound merge calls {@link pinModeHoldOnCanvas}; send failure calls
 * {@link rollbackOptimisticLocalUser}.
 */

import type {
  AgentMode,
  ContentBlock,
  SessionState,
  TimelineItem,
} from "@grok-desktop/acp-core";

/**
 * User prompt already painted on the timeline, not yet given to grok-build.
 * Lives only while a mode switch is in flight.
 */
export type HeldPrompt = {
  /** Trimmed user text. Empty when the send is image-only. */
  text: string;
  /** ACP blocks when the send included images or resource links. */
  blocks?: ContentBlock[];
  /** Canvas session the bubble belongs to. */
  sessionId: string;
};

/**
 * Store fields the mode-hold gate reads. Extra fields on the real store are fine.
 * `live` is the bridge handle; missing methods mean the socket is down.
 */
export type ModeHoldState = {
  session: SessionState;
  connectionMode: string;
  live: {
    setMode: (modeId: string, sessionId?: string) => boolean;
    prompt: (
      text: string,
      sessionId?: string,
      blocks?: ContentBlock[],
    ) => boolean;
    seedSession?: (session: SessionState) => void;
    cancel: (sessionId?: string) => void;
  } | null;
  /** Target still waiting on session/set_mode. Null when the wire matches the chip. */
  pendingMode?: AgentMode | null;
  /** Mode to restore when the switch fails. Null once the wire has caught up. */
  confirmedMode?: AgentMode | null;
  /** Painted prompt waiting for the mode RPC. Null when nothing is held. */
  heldPrompt?: HeldPrompt | null;
  /**
   * Session the in-flight set_mode targeted.
   * Null on a New chat draft until the first send creates a session and fires the RPC.
   */
  modeRpcSessionId?: string | null;
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /** Composer / shell status line. Optional so slices that never fail a switch can omit it. */
  bridgeInfo?: string;
  /** Last hard error. Optional; failure paths may set it when the bridge is gone. */
  lastError?: string | null;
};

/** Zustand set narrowed to the mode-hold fields. */
export type ModeHoldSet<S extends ModeHoldState> = (
  partial: Partial<S> | ((state: S) => Partial<S>),
) => void;

/** Zustand get narrowed to the mode-hold fields. */
export type ModeHoldGet<S extends ModeHoldState> = () => S;

/**
 * True when a timeline row is an unconfirmed optimistic local user bubble.
 * @param item Timeline entry.
 * @returns Whether rollback may remove this row after a failed send.
 */
function isOptimisticLocalUser(item: TimelineItem): boolean {
  return (
    item.kind === "user" &&
    !item.agentConfirmed &&
    (item.origin === "local" || Boolean(item.clientPromptId))
  );
}

/**
 * Remove the newest unconfirmed local user row after a hard send failure.
 * Restores idle status so the composer send button returns; leaves any earlier
 * confirmed history intact.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function rollbackOptimisticLocalUser<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
): void {
  const session = get().session;
  let idx = -1;
  for (let i = session.timeline.length - 1; i >= 0; i -= 1) {
    const item = session.timeline[i];
    if (item && isOptimisticLocalUser(item)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return;
  }
  const timeline = [
    ...session.timeline.slice(0, idx),
    ...session.timeline.slice(idx + 1),
  ];
  set({
    session: {
      ...session,
      timeline,
      status: "idle",
    },
  } as Partial<S>);
}

/**
 * Keep the chip and the fake Working turn stable while grok-build catches up.
 * Inbound frames still carry the old mode and often an idle status. Bridge-owned
 * merge would snap both back. While a switch or a held prompt is in flight, the
 * painted mode stays on the user's choice and status stays streaming.
 * @param canvas Merged canvas about to be written.
 * @param pendingMode Switch target, or null/undefined when idle.
 * @param heldPrompt Painted prompt not yet sent, or null/undefined.
 * @returns Canvas with mode and status pinned, or the same object when nothing is in flight.
 */
export function pinModeHoldOnCanvas(
  canvas: SessionState,
  pendingMode: AgentMode | null | undefined,
  heldPrompt: HeldPrompt | null | undefined,
): SessionState {
  const pending = pendingMode ?? null;
  const held = heldPrompt ?? null;
  if (!pending && !held) {
    return canvas;
  }
  let next = canvas;
  if (pending && next.mode !== pending) {
    next = { ...next, mode: pending };
  }
  const heldHere =
    held !== null &&
    (!held.sessionId || !next.id || held.sessionId === next.id);
  if (heldHere && next.status !== "streaming") {
    next = { ...next, status: "streaming" };
  }
  return next;
}
