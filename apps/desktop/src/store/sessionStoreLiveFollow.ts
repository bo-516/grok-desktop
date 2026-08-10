/**
 * Pure canvas-follow rules for live bridge inbound state.
 * Keeps sessionStoreLive under the line budget and unit-testable without WS.
 */

import type { SessionState, TimelineItem } from "@grok-desktop/acp-core";
import { sessionHasConversationContent } from "@/lib/sessionContent";

/**
 * Decide whether one inbound session snapshot owns the main canvas.
 * An explicit `viewing` id is an isolation boundary: neither the previously
 * active session nor an id-less handshake may repaint it. `active` is only a
 * fallback before a viewing id exists, and the first inbound snapshot is only
 * accepted when neither focus id exists (cold connect). Passing the wrong
 * focus id therefore keeps the snapshot off-canvas instead of mixing two
 * conversations; draft / forceNew gating is applied separately in
 * {@link resolveCanvasFollow}.
 * @param viewing Explicit session selected in the rail, or null before focus.
 * @param active Last canvas-owned live session, or null on a cold connection.
 * @param sessionId Inbound ACP session id; empty is accepted only without focus.
 * @returns True only when the inbound snapshot owns the current canvas.
 */
export function shouldFollowSession(
  viewing: string | null,
  active: string | null,
  sessionId: string,
): boolean {
  if (viewing !== null) {
    return sessionId === viewing;
  }
  if (active !== null) {
    return sessionId === active;
  }
  return true;
}

/**
 * Whether an inbound live state should repaint the main canvas.
 * Protects the New chat draft (`localDraft`): until the user sends, pool
 * broadcasts from other sessions must not overwrite the empty canvas. While
 * `creatingSession` is true, only a fresh empty session (the forceNew
 * handshake) may take the canvas so a still-streaming previous chat cannot win
 * the race. Cold reconnect has `localDraft === false` so the first inbound
 * session still paints normally.
 * @param args Current canvas focus + inbound session snapshot.
 * @returns True when the inbound session should become the painted canvas.
 */
export function resolveCanvasFollow(args: {
  viewing: string | null;
  active: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  inbound: SessionState;
}): boolean {
  if (args.localDraft) {
    if (!args.creatingSession) {
      return false;
    }
    // Accept only the new empty session — not a background streaming resident.
    return !sessionHasConversationContent(args.inbound.timeline);
  }
  return shouldFollowSession(args.viewing, args.active, args.inbound.id);
}

/**
 * True when a timeline row is an unconfirmed optimistic local user bubble.
 * @param item Timeline entry from the painted canvas.
 * @returns Whether the row should survive an empty forceNew handshake paint.
 */
function isOptimisticLocalUser(item: TimelineItem): boolean {
  return (
    item.kind === "user" &&
    !item.agentConfirmed &&
    (item.origin === "local" || Boolean(item.clientPromptId))
  );
}

/**
 * Keep optimistic local user rows when forceNew paints an empty session.
 * Without this, the canvas flashes empty between "user bubble on draft" and
 * the real bridge prompt state — the user would see their message disappear
 * while create session is still in flight.
 * @param inbound Fresh session from the bridge (usually empty timeline).
 * @param local Currently painted canvas (may already show local user rows).
 * @returns Inbound as-is when it already has conversation content or local has
 *   no optimistic rows; otherwise inbound with local optimistic user rows
 *   appended and status streaming so the Stop chrome stays consistent.
 */
export function mergeOptimisticLocalUsers(
  inbound: SessionState,
  local: SessionState,
): SessionState {
  if (sessionHasConversationContent(inbound.timeline)) {
    return inbound;
  }
  const pending = local.timeline.filter(isOptimisticLocalUser);
  if (pending.length === 0) {
    return inbound;
  }
  return {
    ...inbound,
    timeline: [...inbound.timeline, ...pending],
    status: "streaming",
  };
}
