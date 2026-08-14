/**
 * Pure helpers for sessionStore.
 * Keeps resume decisions and local persistence out of the Zustand definition
 * so high-frequency input state is not coupled to the global store.
 */

import {
  createSessionState,
  tagSeedUserMessages,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  enqueueCatalogPersist,
  flushCatalogNow,
} from "./catalogPersistQueue";
import {
  normalizeCatalog,
  recordToSessionState,
  type SessionRecord,
} from "./sessionCatalog";

/** Options for starting/resuming a real bridge session; forceNew=true forbids reusing a historical id. */
export type StartOpts = {
  url?: string;
  alwaysApprove?: boolean;
  cwd?: string;
  resumeId?: string;
  seed?: SessionState;
  forceNew?: boolean;
  /**
   * Open the WebSocket and run env/pool sync without session/start.
   * Automatic reconnect uses this so a New chat draft never forceNew-spawns.
   */
  connectOnly?: boolean;
  /**
   * Post-await guard for async start. When provided, startLiveBridgeSession
   * skips every canvas `set` after an await when this returns false (stale
   * select while a later selection is already in flight).
   */
  guard?: () => boolean;
};

/** Minimal store view read by resolveResumeTarget; keeps helpers free of Zustand implementation details. */
type ResumeSource = {
  viewingSessionId: string | null;
  activeSessionId: string | null;
  session: SessionState;
  catalog: SessionRecord[];
  /**
   * Live pool rows when known. Used so a resume seed keeps Working chrome
   * when the process is still streaming (catalog status is often stale idle).
   */
  poolEntries?: Array<{
    sessionId: string;
    status: SessionState["status"];
    live?: boolean;
  }>;
};

/**
 * Canvas status when seeding a resume / reconnect.
 * A live pool process that is still busy wins. Otherwise keep a busy seed
 * only when the pool snapshot is not yet known (connect race). Never invent
 * streaming — a stale catalog `streaming` without a live process stays idle
 * so send is allowed.
 * @param seedStatus Status on the catalog / select seed.
 * @param poolStatus Live pool status for this session id, if any.
 * @returns Status safe to paint on the resume canvas.
 */
export function resolveResumeCanvasStatus(
  seedStatus: SessionState["status"],
  poolStatus?: SessionState["status"],
): SessionState["status"] {
  if (poolStatus === "streaming" || poolStatus === "waiting_permission") {
    return poolStatus;
  }
  if (seedStatus === "streaming" || seedStatus === "waiting_permission") {
    // Pool listed and not busy — catalog streaming is stale.
    if (poolStatus !== undefined) {
      return "idle";
    }
    return seedStatus;
  }
  return seedStatus === "disconnected" ? "idle" : seedStatus;
}

/** Empty session shown on first paint; without an id, send creates a session via the real bridge. */
export const INITIAL_SESSION = createSessionState({
  id: "",
  workspace: "",
  model: "",
  mode: "build",
});

/**
 * Persist an already-normalized catalog without running normalizeCatalog again.
 * Hot path (inbound updates) must use this after a single normalize at the call site.
 * @param catalog Catalog that has already been through normalizeCatalog (or is known clean).
 */
export function persistNormalizedCatalog(catalog: SessionRecord[]): void {
  enqueueCatalogPersist(catalog);
}

/**
 * Heal seed-user timeline + coerce lastAgentText for wire omit-empty.
 * @param session Raw ACP session from bridge / pool.
 * @returns Healed session ready for routing.
 */
export function healSessionTimeline(session: SessionState): SessionState {
  return {
    ...session,
    // Wire / partial fixtures may omit timeline; never pass undefined into tagger.
    timeline: tagSeedUserMessages(session.timeline ?? []),
    // Empty string is omitted over JSON from bridge-go; keep canvas typed.
    lastAgentText: session.lastAgentText ?? "",
  };
}

/**
 * Normalize then persist the session catalog (cold paths: hydrate, filter-only, remote merge).
 * @param catalog Latest catalog; weak-titled empty sessions are pruned first.
 *   Storage failures (e.g. private mode) are warned by the lower layer.
 * @returns void; callers should still write the same normalized result into Zustand.
 */
export function persistCatalog(catalog: SessionRecord[]): void {
  const normalized = normalizeCatalog(catalog);
  enqueueCatalogPersist(normalized);
}

/**
 * Force any pending throttled catalog write to disk immediately.
 * Call on session switch / disconnect so the latest rail snapshot is not lost.
 */
export function flushCatalogPersist(): void {
  flushCatalogNow();
}

/**
 * Pick the real ACP session to resume so ordinary reconnect never accidentally calls session/new.
 * Catalog seed prefers live pool status when the process is still busy.
 * @param source Stable session view from the current store.
 * @param opts Overrides from the user action; forceNew=true returns only cwd.
 * @returns resumeId, cached seed, and workspace ready to pass to bridge start.
 */
export function resolveResumeTarget(
  source: ResumeSource,
  opts?: StartOpts,
): { resumeId?: string; seed?: SessionState; cwd?: string } {
  const selectedId =
    source.viewingSessionId ||
    source.activeSessionId ||
    source.session.id ||
    source.catalog[0]?.id ||
    "";
  const record = source.catalog.find((item) => item.id === selectedId);

  if (opts?.forceNew) {return { cwd: opts.cwd };}
  if (opts?.resumeId) {
    return { resumeId: opts.resumeId, seed: opts.seed, cwd: opts.cwd };
  }
  if (!selectedId) {return { cwd: opts?.cwd };}

  /** Resume seed: prefer catalog record; otherwise reuse current session when ids match. */
  let seed: ReturnType<typeof recordToSessionState> | undefined;
  const poolStatus = source.poolEntries?.find(
    (entry) => entry.sessionId === selectedId && entry.live !== false,
  )?.status;
  if (record) {
    seed = recordToSessionState(record, poolStatus);
  } else if (source.session.id === selectedId) {
    seed = source.session;
  }

  return {
    resumeId: selectedId,
    seed,
    cwd: opts?.cwd || record?.workspace || source.session.workspace || undefined,
  };
}
