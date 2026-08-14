/**
 * Session store action: fork the open chat into a peer session, then switch to it.
 * The canvas swaps to the centered restore empty state (same "Restoring
 * conversation…" as a cold session/load) for at least
 * {@link FORK_THINKING_HOLD_MS} while `_x.ai/session/fork` runs. Parent status
 * stays idle — a fake `streaming` paint would mount the live-turn strip and
 * swap Send→Stop, which jumps the whole page.
 */

import {
  fallbackSessionLabel,
  parseSessionForkResult,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  normalizeCatalog,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  persistNormalizedCatalog,
} from "./sessionStoreSupport";
import { selectSessionAction } from "./sessionStoreNavigation";
import type {
  SessionStoreGet,
  SessionStoreSet,
} from "./sessionStoreTypes";

/** Result of {@link forkSessionAction}. */
export type ForkSessionResult =
  | { ok: true; newSessionId: string }
  | { ok: false; error: string };

/**
 * Minimum time the centered restore empty state stays up during fork.
 * Covers a fast RPC so the canvas does not flash restore → child in one frame.
 */
export const FORK_THINKING_HOLD_MS = 1000;

/**
 * Sleep until `holdMs` has elapsed since `startedAt`.
 * @param startedAt `Date.now()` when the restore canvas was painted.
 * @param holdMs Minimum hold; 0 or negative returns immediately (unit tests).
 */
export async function waitRemainingHold(
  startedAt: number,
  holdMs: number,
): Promise<void> {
  const left = holdMs - (Date.now() - startedAt);
  if (left <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, left);
  });
}

/**
 * Fork the canvas session into a peer and navigate to the child.
 *
 * Steps: persist parent → paint restore empty → RPC fork → hold remaining
 * thinking time → seed catalog from the parent snapshot → `selectSession`.
 * Failures put the parent transcript back and leave the user on that chat.
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Optional child cwd (worktree path); `holdMs` defaults to
 *   {@link FORK_THINKING_HOLD_MS} and is 0 in unit tests so they stay fast.
 * @returns ok + newSessionId, or error when bridge/session is missing or RPC fails.
 */
export async function forkSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  opts?: { newCwd?: string; holdMs?: number },
): Promise<ForkSessionResult> {
  const { connectionMode, live, session } = get();
  if (connectionMode !== "live-bridge" || !live) {
    return { ok: false, error: "bridge not connected" };
  }
  const sourceSessionId = session.id.trim();
  const sourceCwd = session.workspace.trim();
  if (!sourceSessionId) {
    return { ok: false, error: "no active session to fork" };
  }
  if (!sourceCwd) {
    return { ok: false, error: "session has no workspace to fork" };
  }

  // Persist parent into the rail before the canvas blanks so a failed fork
  // can put the transcript back from this snapshot / catalog row.
  const parentSnapshot = session;
  const catalogBefore = normalizeCatalog(
    upsertFromLiveState(get().catalog, session),
  );
  persistNormalizedCatalog(catalogBefore);
  const holdMs = opts?.holdMs ?? FORK_THINKING_HOLD_MS;
  const startedAt = Date.now();
  set({
    catalog: catalogBefore,
    lastError: null,
    bridgeInfo: "Forking session…",
    viewingSessionId: sourceSessionId,
    restoringSessionId: sourceSessionId,
    // Empty timeline + matching restoringSessionId is the same centered
    // "Restoring conversation…" canvas as a cold session/load.
    session: {
      ...session,
      timeline: [],
    },
  });

  try {
    const result = await live.forkSession(sourceSessionId, {
      sourceCwd,
      newCwd: opts?.newCwd?.trim() || sourceCwd,
    });
    if (!result.ok) {
      restoreParentIdle(set, result.error ?? "fork failed", parentSnapshot);
      return { ok: false, error: result.error ?? "fork failed" };
    }
    const parsed = parseSessionForkResult(result.data);
    if (!parsed?.newSessionId) {
      restoreParentIdle(
        set,
        "fork response missing newSessionId",
        parentSnapshot,
      );
      return { ok: false, error: "fork response missing newSessionId" };
    }
    await waitRemainingHold(startedAt, holdMs);

    const childCwd = (parsed.newCwd || opts?.newCwd || sourceCwd).trim();
    const now = Date.now();
    const parentTitle =
      get().catalog.find((c) => c.id === sourceSessionId)?.title ||
      parentSnapshot.title ||
      fallbackSessionLabel(sourceSessionId);
    const childTitle = parentTitle.startsWith("Fork · ")
      ? parentTitle
      : `Fork · ${parentTitle}`;

    // Seed from the pre-blank snapshot — get().session.timeline is empty
    // while the restore canvas is up, so copying it would keep the child cold.
    const seededCatalog = normalizeCatalog([
      ...get().catalog.filter((c) => c.id !== parsed.newSessionId),
      {
        id: parsed.newSessionId,
        workspace: childCwd,
        title: childTitle,
        mode: parentSnapshot.mode,
        model: parentSnapshot.model,
        status: "idle" as const,
        createdAt: now,
        updatedAt: now,
        timeline: parentSnapshot.timeline,
        toolCalls: parentSnapshot.toolCalls,
        lastAgentText: parentSnapshot.lastAgentText,
        parentSessionId: parsed.parentSessionId || sourceSessionId,
      },
    ]);
    persistNormalizedCatalog(seededCatalog);
    set({
      catalog: seededCatalog,
      restoringSessionId: null,
      session: {
        ...parentSnapshot,
        status: "idle",
      },
      bridgeInfo: `Forked · opening ${childTitle}`,
    });

    const stillOnParent =
      get().viewingSessionId === sourceSessionId ||
      get().session.id === sourceSessionId;
    if (stillOnParent) {
      selectSessionAction(set, get, parsed.newSessionId);
    }
    return { ok: true, newSessionId: parsed.newSessionId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    restoreParentIdle(set, message, parentSnapshot);
    return { ok: false, error: message };
  }
}

/**
 * Restore the parent transcript after a failed fork attempt.
 * @param set Zustand set.
 * @param error Message for lastError / bridgeInfo.
 * @param parent Snapshot taken before the canvas was blanked; missing timeline
 *   would leave the user on the restore empty state after a failed RPC.
 */
function restoreParentIdle(
  set: SessionStoreSet,
  error: string,
  parent: SessionState,
): void {
  set({
    lastError: error,
    bridgeInfo: `Fork failed: ${error}`,
    restoringSessionId: null,
    session: {
      ...parent,
      status: parent.status === "streaming" ? "idle" : parent.status,
    },
  });
}
