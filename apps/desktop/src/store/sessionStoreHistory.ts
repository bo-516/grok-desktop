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
 * In-flight catalog-only prefetches (rail hover → click warm-up).
 * The catalog row's empty timeline is what forces the "Restoring
 * conversation…" gate on select; filling it ahead of the click makes the
 * switch paint the transcript in one frame instead of shimmering then popping.
 */
const prefetchInflight = new Set<string>();
/** Sessions already warmed this run; resolved prefetches never refetch. */
const prefetchDone = new Set<string>();
/** Hover sweeps arm at most this many session_history fetches at once. */
const PREFETCH_CONCURRENCY = 3;

/**
 * Warm one rail row's catalog timeline from `session_history` without
 * touching the canvas. Fires from row hover / focus so a click usually lands
 * after the fetch and selects with a cached timeline — `coldRestore` never
 * engages, so neither the Restoring gate nor the one-frame body pop does.
 *
 * Skips: already-warm rows, in-flight or done sessions, the viewed session
 * (select's own hydrate owns it), non-live bridges, and sweeps beyond
 * {@link PREFETCH_CONCURRENCY}.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Target catalog session id.
 */
export function prefetchSessionHistoryIntoCatalog(
  set: SessionStoreSet,
  get: SessionStoreGet,
  opts: { sessionId: string },
): void {
  const sessionId = opts.sessionId.trim();
  if (
    !sessionId ||
    prefetchDone.has(sessionId) ||
    prefetchInflight.has(sessionId) ||
    prefetchInflight.size >= PREFETCH_CONCURRENCY
  ) {
    return;
  }
  const rec = get().catalog.find((row) => row.id === sessionId);
  if (!rec || rec.timeline.length > 0) {
    return;
  }
  if (get().viewingSessionId === sessionId) {
    return;
  }
  if (get().connectionMode !== "live-bridge") {
    return;
  }
  const live = get().live;
  if (!live) {
    return;
  }
  prefetchInflight.add(sessionId);
  void (async () => {
    try {
      const result = await live.cli(
        "session_history",
        { sessionId, cwd: rec.workspace || undefined },
        rec.workspace || undefined,
      );
      if (!result.ok) {
        return;
      }
      /**
       * Clicked through mid-flight: select seeded the canvas already and its
       * own hydrate/resume owns this session now — writing here would double
       * the admission work for the same body.
       */
      if (get().viewingSessionId === sessionId) {
        return;
      }
      const payload = parseSessionHistoryPayload(result.data);
      const state = sessionStateFromHistoryPayload(payload, {
        sessionId,
        workspace: rec.workspace || payload.cwd || "",
        model: rec.model,
        mode: rec.mode,
        title: rec.title,
      });
      if (!sessionHasConversationContent(state.timeline)) {
        // Genuinely empty on disk — the rec.timeline>0 guard cannot stop a
        // refetch loop, so remember the empty answer for this run.
        prefetchDone.add(sessionId);
        return;
      }
      // Admission requires user-facing provenance for the catalog upsert;
      // viewing === false keeps applyInboundSession catalog-only (no canvas).
      if (!isUserFacingProvenance(get().sessionProvenance?.[sessionId])) {
        set({
          sessionProvenance: stampProvenance(
            get().sessionProvenance ?? {},
            sessionId,
            "resumed",
          ),
        });
      }
      applyInboundSession(set as never, get as never, state, {
        recency: "passive",
      });
      prefetchDone.add(sessionId);
    } catch {
      /* opportunistic: the click path re-fetches through the real hydrate */
    } finally {
      prefetchInflight.delete(sessionId);
    }
  })();
}

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
