/**
 * Live half of selectSession: after the canvas is seeded, either push the
 * selection into an already-live bridge (pool hit / current focus) or start
 * a background resume. Supersession is decided by the caller's guard so a
 * later select can cancel this one's post-await writes.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import type { SessionRecord } from "./sessionCatalogTypes";
import {
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
} from "./sessionStoreLive";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/** Inputs for resumeSelectedSession, all captured by selectSessionAction. */
export type ResumeSelectedSessionArgs = {
  /** Catalog / ACP session id being opened. */
  id: string;
  /** Catalog row for `id` (title / workspace). */
  rec: SessionRecord;
  /** Snapshot already painted on the canvas; also the bridge seed. */
  seeded: SessionState;
  /** Whether the pool reported `id` as live. */
  inPool: boolean;
  /**
   * True while this select is still the latest one. Evaluated after awaits;
   * false skips every later canvas write. A guard that never turns false lets
   * a stale resume repaint over a newer selection.
   */
  isCurrent: () => boolean;
};

/**
 * Attach the selected session to the live bridge.
 * Hit path (bridge live and id in pool or already active) only re-runs
 * `start`; otherwise resumes via startLiveBridgeSession in the background
 * and falls back to local history if that throws.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param args Selection captured by selectSessionAction.
 */
export function resumeSelectedSession(
  set: SessionStoreSet,
  get: SessionStoreGet,
  args: ResumeSelectedSessionArgs,
): void {
  const { id, rec, seeded, inPool, isCurrent } = args;
  // Already in pool or current live focus: only run start hit-path / push state.
  if (
    get().connectionMode === "live-bridge" &&
    get().live &&
    (inPool || id === get().activeSessionId)
  ) {
    get().live?.start({
      resumeId: id,
      cwd: rec.workspace || undefined,
      alwaysApprove: DEFAULT_ALWAYS_APPROVE,
      seed: seeded,
    });
    return;
  }

  void (async () => {
    try {
      await startLiveBridgeSession(set, get, {
        alwaysApprove: DEFAULT_ALWAYS_APPROVE,
        cwd: rec.workspace || undefined,
        resumeId: id,
        seed: seeded,
        // Skip post-await canvas writes when a later select superseded us.
        guard: isCurrent,
      });
      if (!isCurrent()) {
        return;
      }
      set({ bridgeInfo: `live · ${rec.title}` });
    } catch {
      if (!isCurrent()) {
        return;
      }
      set({
        session: seeded,
        viewingSessionId: id,
        restoringSessionId: null,
        bridgeInfo: "Showing local history — resume failed, check bridge",
      });
    }
  })();
}
