/**
 * Per-session session/load replay window for the Node bridge WS fan-out.
 * Suppresses mid-window session_update broadcast; converts the
 * setReplaying(false) state flush into a single replay_end with snapshot.
 */

import type { SessionState, SessionUpdate } from "@grok-desktop/acp-core";
import type { ServerMsg } from "./protocol.js";

/** Broadcast sink used by the lifecycle layer. */
export type ReplayBroadcast = (msg: ServerMsg) => void;

/**
 * Mutable gate state for one startOrResume invocation (one runtime's callbacks).
 */
export type SessionReplayGate = {
  /**
   * AcpClient onReplayChange edge.
   * @param on True when load replay opens, false when it closes.
   * @param sessionId ACP session id (resume id).
   */
  onReplayChange: (on: boolean, sessionId: string) => void;
  /**
   * Raw ACP update path. Buffers stats while replaying; otherwise broadcasts.
   * @param update SessionUpdate payload.
   * @param sessionId Target session.
   * @param eventId Optional wire eventId.
   */
  onSessionUpdate: (
    update: SessionUpdate,
    sessionId: string,
    eventId: string | null,
  ) => void;
  /**
   * State change path. The first state after onReplayChange(false) becomes
   * replay_end; intermediate states while replaying are dropped.
   * @param session Latest SessionState from AcpClient.
   * @returns true when the caller should skip normal lifecycle fan-out
   *   (replay handled the paint / silence).
   */
  onState: (session: SessionState) => boolean;
  /** Test helper: whether a session is currently replaying. */
  isReplaying: (sessionId: string) => boolean;
};

/**
 * Create a per-runtime replay gate bound to a broadcast sink.
 * @param broadcast WS broadcast used for replay_begin / replay_end / session_update.
 */
export function createSessionReplayGate(
  broadcast: ReplayBroadcast,
): SessionReplayGate {
  const replayingSessions = new Set<string>();
  const replayStartedAt = new Map<string, number>();
  const replayCounts = new Map<string, number>();
  const replayBytes = new Map<string, number>();
  const pendingReplayEnd = new Set<string>();

  return {
    onReplayChange(on, sessionId) {
      const sid = sessionId || "";
      if (!sid) {
        return;
      }
      if (on) {
        replayingSessions.add(sid);
        replayStartedAt.set(sid, Date.now());
        replayCounts.set(sid, 0);
        replayBytes.set(sid, 0);
        pendingReplayEnd.delete(sid);
        broadcast({ type: "replay_begin", sessionId: sid });
        return;
      }
      replayingSessions.delete(sid);
      pendingReplayEnd.add(sid);
    },
    onSessionUpdate(update, sessionId, eventId) {
      if (replayingSessions.has(sessionId)) {
        const prev = replayCounts.get(sessionId) ?? 0;
        replayCounts.set(sessionId, prev + 1);
        try {
          const size = JSON.stringify(update).length;
          replayBytes.set(
            sessionId,
            (replayBytes.get(sessionId) ?? 0) + size,
          );
        } catch {
          /* ignore size measure failures */
        }
        return;
      }
      broadcast({
        type: "session_update",
        sessionId,
        update,
        ...(eventId ? { eventId } : {}),
      });
    },
    onState(session) {
      if (session.id && pendingReplayEnd.has(session.id)) {
        pendingReplayEnd.delete(session.id);
        const started = replayStartedAt.get(session.id) ?? Date.now();
        replayStartedAt.delete(session.id);
        const count = replayCounts.get(session.id) ?? 0;
        replayCounts.delete(session.id);
        const bytes = replayBytes.get(session.id) ?? 0;
        replayBytes.delete(session.id);
        broadcast({
          type: "replay_end",
          sessionId: session.id,
          session,
          status: session.status,
          model: session.model,
          mode: session.mode,
          count,
          bytes,
          elapsedMs: Math.max(0, Date.now() - started),
        });
        return true;
      }
      if (session.id && replayingSessions.has(session.id)) {
        return true;
      }
      return false;
    },
    isReplaying(sessionId) {
      return replayingSessions.has(sessionId);
    },
  };
}
