/**
 * Inbound SessionState routing: heal → provenance gate → child/pending or catalog.
 * Whitelist (I2): only local/resumed/disk enter catalog; wire stays pending.
 */

import type { AgentMode, SessionState } from "@grok-desktop/acp-core";
import { loadWorkspacePrefs } from "../lib/workspacePrefs";
import {
  catalogRefsEqual,
  normalizeCatalogRow,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  healSessionTimeline,
  persistNormalizedCatalog,
} from "./sessionStoreSupport";
import { clearPendingModeTimer } from "./pendingMode";
import {
  mergeCanvasInbound,
  preserveLocalUserMedia,
  resolveCanvasFollow,
} from "./sessionStoreLiveFollow";
import {
  mergeRoles,
  promoteChildToCatalog,
  retroTagCatalogRoles,
  rolesFromSubagents,
  terminalChildSessionIds,
  type SessionRoleIndex,
} from "./sessionRoles";
import {
  isUserFacingProvenance,
  putPendingSession,
  stampProvenance,
  stampProvenanceMany,
  type SessionProvenanceIndex,
} from "./sessionProvenance";
import {
  claimPendingAsChildren,
  promotePendingToCatalog,
} from "./sessionStorePending";
import { admitForceNewSessionFromInfo as admitForceNewSessionFromInfoImpl } from "./sessionStoreForceNew";
import {
  isolatedInboundOutcome,
  noteInboundStatus,
  type InboundOutcome,
} from "./sessionTurnEdge";
import type { ConnectionMode, LiveHandle } from "./sessionStoreLiveTypes";
import type {
  EnvironmentInfo,
  PoolEntry,
} from "../bridge/liveBridgeTypes";
import type { SessionRecord } from "./sessionCatalogTypes";
import type { PromptQueueItem } from "@/lib/promptQueue";

export { promotePendingToCatalog } from "./sessionStorePending";
export { shouldStampLocalFromForceNewInfo } from "./sessionProvenance";
export type { InboundOutcome } from "./sessionTurnEdge";

/** Minimal store slice for inbound apply + startLiveBridge. */
export type LiveStoreSlice = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /** Resident process summaries in the pool (rail status lights). */
  poolEntries: PoolEntry[];
  /** CLI / login probe; null means not received yet. */
  environment: EnvironmentInfo | null;
  /** Queued user prompts while streaming (session-scoped items). */
  promptQueue: PromptQueueItem[];
  /** SPAWN restart banner (J-06). */
  restartNotice: string | null;
  /**
   * True after New chat until first send or selectSession.
   * Optional so older call sites still type-check.
   */
  localDraft?: boolean;
  /**
   * True while first send of a New chat draft is forceNew-creating.
   * Optional so older call sites still type-check.
   */
  creatingSession?: boolean;
  /**
   * In-flight mode switch target; cleared when inbound session.mode matches.
   * Optional so older call sites still type-check.
   */
  pendingMode?: AgentMode | null;
  /**
   * Uncached session waiting for session/load replay to land.
   * Optional so older call sites still type-check.
   */
  restoringSessionId?: string | null;
  /**
   * childSessionId → { parentSessionId, sessionKind }.
   * Live first-hand from subagent cards; also rebuilt from catalog on hydrate.
   */
  sessionRoles?: SessionRoleIndex;
  /**
   * In-memory reduce buffers for known child sessions (not persisted).
   * Streaming updates land here so the rail catalog stays still.
   */
  childSessions?: Record<string, SessionState>;
  /**
   * sessionId → provenance (local/resumed/disk/child/wire).
   * Wire is default; only user-facing provenances enter the catalog.
   */
  sessionProvenance?: SessionProvenanceIndex;
  /**
   * Unproven wire-only session buffers (not persisted). Claimed by spawn,
   * sessions_list, or disconnect/hide flush.
   */
  pendingSessions?: Record<string, SessionState>;
  /** Oldest-first order of pendingSessions keys (for bounded eviction). */
  pendingSessionOrder?: string[];
  /**
   * Monotonic counter bumped only when catalog row identity set changes in a
   * way that affects openable-child Sets (Agents rail deps).
   */
  catalogRevision?: number;
};

export type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;
export type GetState = () => LiveStoreSlice;

export { healSessionTimeline } from "./sessionStoreSupport";

/**
 * Parent id → workspace from catalog rows (for child noProject heal).
 * @param catalog Current catalog.
 * @returns Map of session id to non-empty workspace.
 */
function parentWorkspaceMap(
  catalog: SessionRecord[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rec of catalog) {
    if (rec.workspace.trim()) {
      out[rec.id] = rec.workspace;
    }
  }
  return out;
}

/**
 * Stamp `local` from forceNew ready-info; re-admits pending if needed.
 * @param set Zustand set. @param get Zustand get.
 * @param sessionId Info session id. @param message Ready-contract text.
 * @returns True when local was stamped for this id.
 */
export function admitForceNewSessionFromInfo(
  set: SetState,
  get: GetState,
  sessionId: string | undefined | null,
  message: string | undefined | null,
): boolean {
  return admitForceNewSessionFromInfoImpl(
    set as never,
    get as never,
    sessionId,
    message,
    applyInboundSession as never,
  );
}

/**
 * Route one inbound SessionState (hydrate or post-reduce relay) into catalog + canvas.
 * Shared by full `state` and client-reduced `session_update` so both paths stay identical.
 *
 * Admission (I2): provenance must be user-facing (local/resumed/disk) before
 * catalog upsert. Known children buffer in childSessions; unproven wire ids
 * buffer in pendingSessions. Viewing a child still uses the canvas path.
 * forceNew `local` is stamped from bridge info (session ready), not empty state.
 *
 * Does not drain the prompt queue or fire occupancy RPC — those are live
 * apply-site reactions to {@link InboundOutcome.turnSettled} / follow.
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param session SessionState after heal-ready reduce / hydrate.
 * @param opts `recency: "passive"` keeps catalog recency (select / load)
 *   and never reports `turnSettled`.
 * @returns Frame facts for the live apply site (hydrate callers ignore them).
 */
export function applyInboundSession(
  set: SetState,
  get: GetState,
  session: SessionState,
  opts?: { recency?: "live" | "passive" },
): InboundOutcome {
  /** Snapshot with legacy duplicate seed rows normalized before routing. */
  const healedTimeline = healSessionTimeline(session);
  // User chose "work without a project": bridge still has a default
  // cwd for the agent process, but do not let that overwrite the UI
  // selection or catalog grouping a few seconds later.
  const healedBase = loadWorkspacePrefs().noProject
    ? { ...healedTimeline, workspace: "" }
    : healedTimeline;
  /**
   * Live reduce only has text echoes of prompts; optimistic paint already
   * holds image ContentBlocks. Merge media onto the same-session canvas
   * before catalog upsert so thumbs survive mid-turn and disk cache.
   */
  const healed = preserveLocalUserMedia(healedBase, get().session);

  // Parent subagents are the first-hand role source (before sessions_list).
  const prevRoles = get().sessionRoles ?? {};
  const roles = mergeRoles(prevRoles, rolesFromSubagents(healed));
  const viewing = get().viewingSessionId;

  // Child stamps from roles; forceNew `local` is stamped only from bridge
  // `info` (session <id> ready) — never from empty inbound state frames
  // (wire children share that empty-timeline shape and would hijack New chat).
  let provenance = stampProvenanceMany(
    get().sessionProvenance ?? {},
    Object.keys(roles),
    "child",
  );

  let pending = get().pendingSessions ?? {};
  let pendingOrder = get().pendingSessionOrder ?? [];
  let childSessions = { ...(get().childSessions ?? {}) };

  // Spawn claim: pending id that just got a role → child buffer.
  {
    const claimed = claimPendingAsChildren(
      pending,
      pendingOrder,
      childSessions,
      roles,
      provenance,
    );
    pending = claimed.pending;
    pendingOrder = claimed.order;
    childSessions = claimed.childSessions;
    provenance = claimed.provenance;
  }

  const isKnownChild = Boolean(roles[healed.id]);
  const viewingThisChild = viewing !== null && viewing === healed.id;
  const userFacing = isUserFacingProvenance(provenance[healed.id]);

  // Unproven wire id (and known children not being viewed): isolate — no catalog.
  if (!userFacing && !viewingThisChild) {
    if (isKnownChild) {
      childSessions = { ...childSessions, [healed.id]: healed };
      // Retro-tag any catalog row already created out of order for this child.
      const parentWs = parentWorkspaceMap(get().catalog);
      const tagged = retroTagCatalogRoles(get().catalog, roles, parentWs);
      const catalogChanged = tagged !== get().catalog;
      if (catalogChanged) {
        const healedRows = tagged.map((r) =>
          roles[r.id] ? normalizeCatalogRow(r) : r,
        );
        persistNormalizedCatalog(healedRows);
        set({
          sessionRoles: roles,
          sessionProvenance: provenance,
          childSessions,
          pendingSessions: pending,
          pendingSessionOrder: pendingOrder,
          catalog: healedRows,
          catalogRevision: (get().catalogRevision ?? 0) + 1,
        });
        return isolatedInboundOutcome(healed.id);
      }
      set({
        sessionRoles: roles,
        sessionProvenance: provenance,
        childSessions,
        pendingSessions: pending,
        pendingSessionOrder: pendingOrder,
      });
      return isolatedInboundOutcome(healed.id);
    }

    // Wire-only: pending isolation (never localStorage until claimed).
    const put = putPendingSession(pending, healed.id, healed, pendingOrder);
    pending = put.pending;
    pendingOrder = put.order;
    let catalog = get().catalog;
    let rev = get().catalogRevision ?? 0;
    if (put.evictId && put.evicted) {
      // Flush-before-evict so capacity cannot drop a real multi-client session.
      provenance = stampProvenance(provenance, put.evictId, "disk");
      catalog = promotePendingToCatalog(catalog, put.evicted);
      rev += 1;
      persistNormalizedCatalog(catalog);
    }
    set({
      sessionRoles: roles,
      sessionProvenance: provenance,
      childSessions,
      pendingSessions: pending,
      pendingSessionOrder: pendingOrder,
      ...(catalog !== get().catalog
        ? { catalog, catalogRevision: rev }
        : {}),
    });
    return isolatedInboundOutcome(healed.id);
  }

  // User-facing (or viewed child): catalog path.
  // Ensure child role still stamps when viewing a child mid-stream.
  if (isKnownChild) {
    provenance = stampProvenance(provenance, healed.id, "child");
  }

  const prevCatalog = get().catalog;
  let catalog = upsertFromLiveState(
    prevCatalog,
    healed,
    Date.now(),
    opts?.recency ? { recency: opts.recency } : undefined,
  );
  // Retro-tag siblings that may already sit in the catalog without kind.
  const parentWs = parentWorkspaceMap(catalog);
  catalog = retroTagCatalogRoles(catalog, roles, parentWs);
  // Promote terminal children buffered from earlier streaming frames.
  for (const childId of terminalChildSessionIds(healed)) {
    const buffered = childSessions[childId];
    const role = roles[childId];
    if (!buffered || !role) {
      continue;
    }
    catalog = promoteChildToCatalog(
      catalog,
      buffered,
      role,
      healed.workspace || parentWs[role.parentSessionId] || "",
    );
    delete childSessions[childId];
    // Terminal promote keeps the row in catalog for L3 but rail still hides
    // subagent kinds; provenance stays child.
    provenance = stampProvenance(provenance, childId, "child");
  }
  // Hot path: only re-heal rows that changed identity (id present in roles
  // or the upserted parent), not a full normalizeCatalog walk.
  if (catalog !== prevCatalog) {
    catalog = catalog.map((rec) => {
      if (rec.id === healed.id || roles[rec.id]) {
        return normalizeCatalogRow(rec);
      }
      return rec;
    });
  }
  // Reuse prior array reference when every slot is the same object (no churn).
  if (catalogRefsEqual(prevCatalog, catalog)) {
    catalog = prevCatalog;
  } else {
    persistNormalizedCatalog(catalog);
  }

  /** Last canvas-owned live id, used only before an explicit selection exists. */
  const active = get().activeSessionId;
  /** Whether this inbound snapshot may update canvas-scoped state. */
  const follow = resolveCanvasFollow({
    viewing,
    active,
    localDraft: Boolean(get().localDraft),
    creatingSession: Boolean(get().creatingSession),
    inbound: healed,
  });
  // Mode requests belong to the painted chat; a background session
  // using the same mode must not acknowledge the foreground request.
  const pendingMode = get().pendingMode ?? null;
  const modeConfirmed =
    follow && pendingMode !== null && healed.mode === pendingMode;
  if (modeConfirmed) {
    clearPendingModeTimer();
  }
  // Only a canvas-owned snapshot may promote activeSessionId. Keeping
  // background ids out prevents alternating streams from taking turns
  // satisfying the active fallback and repainting the selected chat.
  const nextActive = follow && healed.id ? healed.id : active;
  // Go empty hydrate / short partial reduce must not blank a catalog-seeded
  // canvas; forceNew still keeps optimistic local user bubbles only.
  const canvasSession = follow
    ? mergeCanvasInbound(healed, get().session, catalog)
    : healed;
  // Replay landed: the first snapshot for this id that carries content
  // is the single post-load flush. A session that really is empty keeps
  // the hint until the user's first prompt fills the canvas — harmless,
  // and it never hides content that exists.
  // Capture before set(): restoreDone clears restoringSessionId.
  const stillRestoring = get().restoringSessionId === healed.id;
  const restoreDone = stillRestoring && healed.timeline.length > 0;
  const catalogChanged = catalog !== prevCatalog;
  set({
    ...(catalogChanged
      ? {
          catalog,
          catalogRevision: (get().catalogRevision ?? 0) + 1,
        }
      : {}),
    sessionRoles: roles,
    sessionProvenance: provenance,
    childSessions,
    pendingSessions: pending,
    pendingSessionOrder: pendingOrder,
    activeSessionId: nextActive,
    connectionMode: "live-bridge",
    lastError: null,
    ...(restoreDone ? { restoringSessionId: null } : {}),
    ...(modeConfirmed ? { pendingMode: null } : {}),
    ...(follow
      ? {
          session: canvasSession,
          viewingSessionId: healed.id || viewing,
          // Handshake painted the forceNew session — leave draft mode.
          ...(get().creatingSession && healed.id
            ? { creatingSession: false, localDraft: false }
            : {}),
        }
      : {}),
  });
  const passive = opts?.recency === "passive";
  const turnSettled =
    !passive &&
    follow &&
    !stillRestoring &&
    noteInboundStatus(healed.id, healed.status);
  return {
    sessionId: healed.id,
    follow,
    restoreDone,
    turnSettled,
  };
}
