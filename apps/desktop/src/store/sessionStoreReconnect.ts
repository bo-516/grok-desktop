/**
 * Automatic live-bridge reconnect while the WebSocket is down.
 * Resumes the viewing session when one exists; never forceNew (New chat
 * stays a local draft until the user sends).
 */

import { resolveAutoReconnectStart } from "@/lib/bridgeReconnect";
import { recordToSessionState } from "./sessionCatalog";
import {
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
} from "./sessionStoreLive";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * Open the bridge WebSocket if disconnected; resume a known session when
 * possible. No-op while connecting or already live. Does not create a grok
 * session — sendPrompt still forceNew on a New chat draft.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export async function ensureLiveBridgeConnected(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<void> {
  const state = get();
  if (state.connectionMode !== "disconnected") {
    return;
  }
  const plan = resolveAutoReconnectStart({
    viewingSessionId: state.viewingSessionId,
    sessionId: state.session.id,
    localDraft: state.localDraft,
    catalogId: state.catalog[0]?.id,
  });
  if (plan.connectOnly) {
    await startLiveBridgeSession(set, get, {
      alwaysApprove: DEFAULT_ALWAYS_APPROVE,
      cwd: state.session.workspace.trim() || undefined,
      connectOnly: true,
    });
    return;
  }
  const resumeId = plan.resumeId;
  const rec = state.catalog.find((row) => row.id === resumeId);
  await startLiveBridgeSession(set, get, {
    alwaysApprove: DEFAULT_ALWAYS_APPROVE,
    cwd: rec?.workspace || state.session.workspace || undefined,
    resumeId,
    seed: rec ? recordToSessionState(rec) : state.session,
    forceNew: false,
  });
}
