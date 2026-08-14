/**
 * Cold-open disk hydrate: paint chat_history / updates.jsonl before session/load.
 * Does not spawn grok-build. The live start path still runs in parallel so
 * send stays on the real agent.
 */

import { sessionHasConversationContent } from "@/lib/sessionContent";
import {
  parseSessionHistoryPayload,
  sessionStateFromHistoryPayload,
} from "@/lib/sessionHistory";
import {
  isUserFacingProvenance,
  stampProvenance,
} from "./sessionProvenance";
import { applyInboundSession } from "./sessionStoreLiveInbound";
import type { LiveHandle } from "./sessionStoreLiveTypes";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/** In-flight hydrate per session so select + startLive do not double-fetch. */
const inflight = new Map<string, Promise<boolean>>();

/**
 * Fetch on-disk history for the viewing session and paint it when the canvas
 * is still empty. No-ops when the bridge is down, the user already switched,
 * or the canvas already has user/agent content.
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Target session + optional live handle / stale-select guard.
 * @returns True when a non-empty timeline was applied.
 */
export async function hydrateViewingSessionFromDisk(
  set: SessionStoreSet,
  get: SessionStoreGet,
  opts: {
    sessionId: string;
    cwd?: string;
    guard?: () => boolean;
    live?: LiveHandle | null;
  },
): Promise<boolean> {
  const sessionId = opts.sessionId.trim();
  if (!sessionId) {
    return false;
  }
  const existing = inflight.get(sessionId);
  if (existing) {
    return existing;
  }
  const pending = runHydrate(set, get, { ...opts, sessionId }).finally(() => {
    inflight.delete(sessionId);
  });
  inflight.set(sessionId, pending);
  return pending;
}

/**
 * Body of {@link hydrateViewingSessionFromDisk} without the inflight lock.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Target session + optional live handle / stale-select guard.
 * @returns True when a non-empty timeline was applied.
 */
async function runHydrate(
  set: SessionStoreSet,
  get: SessionStoreGet,
  opts: {
    sessionId: string;
    cwd?: string;
    guard?: () => boolean;
    live?: LiveHandle | null;
  },
): Promise<boolean> {
  const stillCurrent = (): boolean => {
    if (opts.guard && !opts.guard()) {
      return false;
    }
    return get().viewingSessionId === opts.sessionId;
  };

  if (alreadyHasBody(get, opts.sessionId)) {
    clearRestoring(set, get, opts.sessionId);
    return true;
  }

  let live = opts.live ?? get().live;
  if (live && get().connectionMode === "connecting") {
    try {
      await live.ready;
    } catch {
      return false;
    }
    if (!stillCurrent()) {
      return false;
    }
    live = get().live ?? live;
  }
  if (!live || get().connectionMode === "disconnected") {
    return false;
  }
  if (!stillCurrent()) {
    return false;
  }

  if (alreadyHasBody(get, opts.sessionId)) {
    clearRestoring(set, get, opts.sessionId);
    return true;
  }

  let data: unknown;
  try {
    const result = await live.cli(
      "session_history",
      { sessionId: opts.sessionId, cwd: opts.cwd },
      opts.cwd,
    );
    if (!result.ok) {
      return false;
    }
    data = result.data;
  } catch {
    return false;
  }
  if (!stillCurrent()) {
    return false;
  }
  if (alreadyHasBody(get, opts.sessionId)) {
    clearRestoring(set, get, opts.sessionId);
    return true;
  }

  const payload = parseSessionHistoryPayload(data);
  const current = get().session;
  const rec = get().catalog.find((row) => row.id === opts.sessionId);
  const state = sessionStateFromHistoryPayload(payload, {
    sessionId: opts.sessionId,
    workspace:
      opts.cwd?.trim() ||
      rec?.workspace ||
      payload.cwd ||
      current.workspace ||
      "",
    model: rec?.model || current.model,
    mode: rec?.mode || current.mode,
    title: rec?.title || current.title,
  });
  if (!sessionHasConversationContent(state.timeline)) {
    return false;
  }
  // applyInboundSession only upserts user-facing provenance; disk hydrate
  // of a catalog row is a resume, not a wire-only ghost.
  if (!isUserFacingProvenance(get().sessionProvenance?.[opts.sessionId])) {
    set({
      sessionProvenance: stampProvenance(
        get().sessionProvenance ?? {},
        opts.sessionId,
        "resumed",
      ),
    });
  }
  if (
    current.id === opts.sessionId &&
    current.timeline.length > state.timeline.length
  ) {
    clearRestoring(set, get, opts.sessionId);
    return true;
  }

  get().live?.seedSession(state);
  applyInboundSession(set as never, get as never, state, {
    recency: "passive",
  });
  clearRestoring(set, get, opts.sessionId);
  return sessionHasConversationContent(get().session.timeline);
}

/**
 * Whether the painted canvas already has user/agent content for this id.
 * @param get Zustand get.
 * @param sessionId Target session.
 */
function alreadyHasBody(get: SessionStoreGet, sessionId: string): boolean {
  const session = get().session;
  return (
    session.id === sessionId && sessionHasConversationContent(session.timeline)
  );
}

/**
 * Drop the Restoring hint once this session has something to show (or we
 * decided the disk snapshot is not needed).
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Session that just hydrated.
 */
function clearRestoring(
  set: SessionStoreSet,
  get: SessionStoreGet,
  sessionId: string,
): void {
  if (get().restoringSessionId === sessionId) {
    set({ restoringSessionId: null });
  }
}
