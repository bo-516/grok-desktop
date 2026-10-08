/**
 * session/start after the WebSocket is up.
 * Split from sessionStoreLive so connect stays under the line limit.
 * connectOnly never reaches this module.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import type { StartOpts as BridgeStartOpts } from "../bridge/liveBridge";
import { sessionHasConversationContent } from "@/lib/sessionContent";
import { hydrateViewingSessionFromDisk } from "./sessionStoreHistory";
import { peekPendingWorktreeStart } from "@/lib/worktreeChatPending";
import { resolveResumeCanvasStatus } from "./sessionStoreSupport";
import { stopCatalogRefresh } from "./sessionStoreCatalogPoll";
import { stopPoolPoll } from "./sessionStorePoolPoll";
import type { GetState, SetState } from "./sessionStoreLiveInbound";
import type { LiveHandle } from "./sessionStoreLiveTypes";

/**
 * Arguments for painting a resume and calling session/start.
 * A missing resumeId with forceNew false starts whatever the bridge defaults.
 */
export type LiveSessionStartArgs = {
  /** Catalog id to resume. Ignored when forceNew is true. */
  resumeId?: string;
  /** Catalog snapshot used when disk history is empty. */
  seed?: SessionState;
  /** Workspace for disk hydrate and session/start. */
  cwd?: string;
  /** When true, session/start must not reuse resumeId. */
  forceNew: boolean;
  /** Tool auto-approve flag forwarded to the bridge. */
  alwaysApprove: boolean;
  /**
   * False after a later select superseded this start.
   * Canvas writes after an await must stop when this returns false.
   */
  stillCurrent: () => boolean;
};

/**
 * Paint a cold resume from disk when the canvas is empty, then session/start.
 * Disk history is painted before grok-build so Restoring is not gated on
 * initialize. A stale select returns without throwing. A closed socket marks
 * the store disconnected, stops the idle rail refresh, and throws.
 * @param set Zustand set from startLiveBridgeSession.
 * @param get Zustand get from startLiveBridgeSession.
 * @param live Open bridge handle; ready has already been awaited.
 * @param args Resume id, seed, cwd, approve flag, and the stale-select guard.
 * @returns Nothing. Throws when the socket cannot accept session/start.
 */
export async function beginLiveSessionStart(
  set: SetState,
  get: GetState,
  live: LiveHandle,
  args: LiveSessionStartArgs,
): Promise<void> {
  const { resumeId, seed, cwd, forceNew, alwaysApprove, stillCurrent } = args;

  // Cold resume: paint disk history before spawning grok-build so Restoring
  // is not gated on initialize / MCP / session/load replay.
  if (resumeId && !forceNew) {
    const viewing = get().session;
    const needsHistory =
      viewing.id === resumeId &&
      !sessionHasConversationContent(viewing.timeline);
    if (needsHistory) {
      await hydrateViewingSessionFromDisk(set as never, get as never, {
        sessionId: resumeId,
        cwd: cwd || viewing.workspace || undefined,
        guard: stillCurrent,
        live,
      });
      if (!stillCurrent()) {
        return;
      }
    }
  }

  const paintedAfterHydrate = get().session;
  const keepDiskBody =
    Boolean(resumeId) &&
    paintedAfterHydrate.id === resumeId &&
    sessionHasConversationContent(paintedAfterHydrate.timeline);
  if (seed && resumeId && !keepDiskBody) {
    const poolStatus = get().poolEntries.find(
      (entry) => entry.sessionId === resumeId && entry.live,
    )?.status;
    const status = resolveResumeCanvasStatus(seed.status, poolStatus);
    set({
      session: {
        ...seed,
        status,
        pendingPermission:
          status === "waiting_permission"
            ? seed.pendingPermission
            : undefined,
      },
      viewingSessionId: resumeId,
      activeSessionId: resumeId,
    });
  } else if (resumeId) {
    set({ viewingSessionId: resumeId, activeSessionId: resumeId });
  }

  const painted = get().session;
  const seedForStart =
    !forceNew &&
    resumeId &&
    painted.id === resumeId &&
    sessionHasConversationContent(painted.timeline)
      ? painted
      : seed;
  // Only the forceNew that actually starts a draft reads the composer
  // option. Resume and reconnect leave it in place for a later new chat.
  const worktree = forceNew ? peekPendingWorktreeStart() : undefined;
  const startOpts: BridgeStartOpts = {
    alwaysApprove,
    cwd,
    resumeId: forceNew ? undefined : resumeId,
    seed: forceNew ? undefined : seedForStart,
    forceNew,
    worktree,
  };
  const started = live.start(startOpts);
  if (!started) {
    stopPoolPoll();
    // Same disconnect as onClose: do not keep listing ~/.grok/sessions.
    stopCatalogRefresh();
    if (!stillCurrent()) {
      throw new Error("bridge WebSocket not open");
    }
    set({
      connectionMode: "disconnected",
      lastError: "WebSocket not connected",
      bridgeInfo: "Cannot write to bridge — run npm run bridge and retry",
    });
    throw new Error("bridge WebSocket not open");
  }

  if (!stillCurrent()) {
    return;
  }

  let liveInfo = "live · connected";
  if (resumeId && !forceNew) {
    liveInfo = "live · resumed";
  } else if (forceNew) {
    liveInfo = "live · new session";
  }
  set({
    connectionMode: "live-bridge",
    bridgeInfo: liveInfo,
    viewingSessionId: forceNew
      ? get().viewingSessionId
      : resumeId ?? get().viewingSessionId,
  });
}
