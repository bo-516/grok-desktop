/**
 * Session store action: fork the open chat into a peer session, then switch to it.
 * Shows a streaming ("thinking") strip while `_x.ai/session/fork` runs; on success
 * seeds the catalog and selects the child so the canvas lands on the forked branch.
 */

import {
  fallbackSessionLabel,
  parseSessionForkResult,
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
 * Fork the canvas session into a peer and navigate to the child.
 *
 * Steps: paint streaming status → RPC fork → seed catalog from parent snapshot
 * → `selectSession(newSessionId)` so session/load hydrates the forked branch.
 * Failures restore idle and leave the user on the parent chat.
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Optional child cwd (worktree path); defaults to the parent workspace.
 * @returns ok + newSessionId, or error when bridge/session is missing or RPC fails.
 */
export async function forkSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  opts?: { newCwd?: string },
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

  // Persist parent into the rail before status flips to streaming.
  const catalogBefore = normalizeCatalog(
    upsertFromLiveState(get().catalog, session),
  );
  persistNormalizedCatalog(catalogBefore);
  set({
    catalog: catalogBefore,
    lastError: null,
    bridgeInfo: "Forking session…",
    // Streaming drives the turn-status strip (Thinking / Working) during the wait.
    session: {
      ...session,
      status: "streaming",
    },
  });

  try {
    const result = await live.forkSession(sourceSessionId, {
      sourceCwd,
      newCwd: opts?.newCwd?.trim() || sourceCwd,
    });
    if (!result.ok) {
      restoreParentIdle(set, get, result.error ?? "fork failed");
      return { ok: false, error: result.error ?? "fork failed" };
    }
    const parsed = parseSessionForkResult(result.data);
    if (!parsed?.newSessionId) {
      restoreParentIdle(set, get, "fork response missing newSessionId");
      return { ok: false, error: "fork response missing newSessionId" };
    }

    const parent = get().session;
    const childCwd = (parsed.newCwd || opts?.newCwd || sourceCwd).trim();
    const now = Date.now();
    const parentTitle =
      get().catalog.find((c) => c.id === sourceSessionId)?.title ||
      parent.title ||
      fallbackSessionLabel(sourceSessionId);
    const childTitle = parentTitle.startsWith("Fork · ")
      ? parentTitle
      : `Fork · ${parentTitle}`;

    // Seed catalog so selectSession can resolve the child before disk sync.
    const seededCatalog = normalizeCatalog([
      ...get().catalog.filter((c) => c.id !== parsed.newSessionId),
      {
        id: parsed.newSessionId,
        workspace: childCwd,
        title: childTitle,
        mode: parent.mode,
        model: parent.model,
        status: "idle" as const,
        createdAt: now,
        updatedAt: now,
        timeline: parent.timeline,
        toolCalls: parent.toolCalls,
        lastAgentText: parent.lastAgentText,
        parentSessionId: parsed.parentSessionId || sourceSessionId,
      },
    ]);
    persistNormalizedCatalog(seededCatalog);
    set({
      catalog: seededCatalog,
      // Clear streaming on parent snapshot still in store; select overwrites canvas.
      session: {
        ...parent,
        status: "idle",
      },
      bridgeInfo: `Forked · opening ${childTitle}`,
    });

    selectSessionAction(set, get, parsed.newSessionId);
    return { ok: true, newSessionId: parsed.newSessionId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    restoreParentIdle(set, get, message);
    return { ok: false, error: message };
  }
}

/**
 * Restore the parent canvas to idle after a failed fork attempt.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param error Message for lastError / bridgeInfo.
 */
function restoreParentIdle(
  set: SessionStoreSet,
  get: SessionStoreGet,
  error: string,
): void {
  const session = get().session;
  set({
    lastError: error,
    bridgeInfo: `Fork failed: ${error}`,
    session: {
      ...session,
      status: session.status === "streaming" ? "idle" : session.status,
    },
  });
}
