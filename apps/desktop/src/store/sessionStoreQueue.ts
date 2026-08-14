/**
 * Session store actions for the composer follow-up queue (grok-build Send now /
 * Edit / Cancel). Queue math lives in `@/lib/promptQueue`; this file only
 * binds those helpers to the canvas session and the live cancel/send path.
 */

import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";
import {
  dequeuePromptForSession,
  planSendQueuedNow,
  takeQueuedById,
} from "@/lib/promptQueue";
import { cancelTurnAction, sendPromptAction } from "./sessionStorePrompt";

/**
 * True when the open canvas (or its pool resident) cannot accept a new turn.
 * Mirrors the sendPromptAction queue gate so Send now does not double-queue.
 * @param get Zustand get.
 * @returns Whether the current turn is streaming or blocked on permission.
 */
export function isCanvasTurnBusy(get: SessionStoreGet): boolean {
  const session = get().session;
  const canvasId =
    session.id.trim() || get().viewingSessionId?.trim() || "";
  const poolStatus = canvasId
    ? get().poolEntries.find((entry) => entry.sessionId === canvasId)?.status
    : undefined;
  return (
    session.status === "streaming" ||
    session.status === "waiting_permission" ||
    poolStatus === "streaming" ||
    poolStatus === "waiting_permission"
  );
}

/**
 * Drop one queued follow-up (Cancel, or Edit after the text is copied out).
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Queue row id; missing / unknown is a no-op.
 * @returns Removed text, or null when the id was not in the queue.
 */
export function removeQueuedPromptAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
): string | null {
  const { item, rest } = takeQueuedById(get().promptQueue, id);
  if (!item) {
    return null;
  }
  set({ promptQueue: rest });
  return item.text;
}

/**
 * Send now (grok-build interject): stop the in-flight turn and make this
 * follow-up the next prompt. The row stays in the strip until the cancelled
 * turn settles and the existing idle drain delivers it, so it appears at the
 * bottom of the transcript — not mid-stream.
 * On an already-idle canvas the row is removed and sent immediately.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Queue row id; missing / unknown is a no-op.
 */
export function sendQueuedNowAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
): void {
  const plan = planSendQueuedNow(
    get().promptQueue,
    id,
    isCanvasTurnBusy(get),
  );
  if (plan.kind === "none") {
    return;
  }
  if (plan.kind === "interrupt") {
    set({
      promptQueue: plan.queue,
      bridgeInfo: "Sending now — interrupting the current turn",
    });
    cancelTurnAction(get);
    return;
  }
  set({ promptQueue: plan.queue });
  void sendPromptAction(set, get, plan.text);
}

/**
 * After a real busy→idle settle, send this session's next queued follow-up.
 * Only the painted canvas may drain — another session's items stay queued
 * until the user switches back. Send goes through sendPromptAction (optimistic
 * bubble, pool/status gate, sendInFlight lock), never a raw live.prompt.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Settled session id; no-op when it is not the canvas id.
 */
export function drainQueueForSettledTurn(
  set: SessionStoreSet,
  get: SessionStoreGet,
  sessionId: string,
): void {
  if (!sessionId || get().session.id !== sessionId) {
    return;
  }
  const { head, rest } = dequeuePromptForSession(get().promptQueue, sessionId);
  if (!head) {
    return;
  }
  set({ promptQueue: rest });
  void sendPromptAction(set, get, head);
}
