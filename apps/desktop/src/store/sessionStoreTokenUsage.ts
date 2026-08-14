/**
 * Restore / idle backfill for the composer context ring.
 * Purpose: session/load replay often omits envelope `_meta.totalTokens` and
 * `turn_completed`, so a reopened chat paints 0% even when grok-build still
 * knows occupancy (`signals.json.contextTokensUsed` / `session/token_usage`).
 * Boundary: one in-flight RPC per session id; does not invent zeros.
 */

import {
  hasLiveContextOccupancy,
  mergeTurnUsagePreservingOccupancy,
  parseTokenUsageRpc,
  type SessionTokenUsage,
} from "@grok-desktop/acp-core";
import { persistNormalizedCatalog } from "./sessionStoreSupport";
import { upsertFromLiveState } from "./sessionCatalog";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * Merge a backfill snapshot onto the canvas/catalog bag.
 * Occupancy-only RPC results (`used` copied into inputTokens) must not wipe
 * a richer billed turn rollup the reduce already stored.
 * @param incoming Parsed RPC / usage_update snapshot.
 * @param previous Current session or catalog tokenUsage.
 */
function mergeBackfillUsage(
  incoming: SessionTokenUsage,
  previous: SessionTokenUsage | undefined,
): SessionTokenUsage {
  const occupancyOnly =
    incoming.contextTokensUsed !== undefined &&
    incoming.inputTokens === incoming.contextTokensUsed &&
    incoming.outputTokens === 0;
  if (occupancyOnly && previous) {
    return { ...previous, contextTokensUsed: incoming.contextTokensUsed };
  }
  return mergeTurnUsagePreservingOccupancy(incoming, previous);
}

/** Session ids already asked (success or hard miss) — avoids idle-frame spam. */
const occupancyBackfillAttempted = new Set<string>();

/**
 * sessionId → latest issued refresh generation. Only the matching reply
 * may write; an older RPC that resolves after a newer one is dropped.
 */
const usageGeneration = new Map<string, number>();

/**
 * Drop the backfill latch when a turn starts so a later idle can refresh
 * occupancy after compact / a new prompt. Also clears the RPC generation
 * so a later test / reconnect cannot inherit a stale latch.
 * @param sessionId Session whose live occupancy may change again.
 */
export function resetTokenUsageBackfill(sessionId: string): void {
  if (sessionId) {
    occupancyBackfillAttempted.delete(sessionId);
    usageGeneration.delete(sessionId);
  }
}

/**
 * True when the canvas ring still has no live occupancy to show.
 * @param usage Current session.tokenUsage (may be billed-only).
 */
export function needsOccupancyBackfill(
  usage: SessionTokenUsage | undefined,
): boolean {
  return !hasLiveContextOccupancy(usage);
}

/**
 * Fetch `session/token_usage` and merge occupancy onto the matching canvas
 * + catalog row. Silent on disconnect / missing method / parse failure.
 * Overlapping calls for one id keep only the later request's result.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Session whose process should answer the RPC.
 */
export async function refreshSessionTokenUsageAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  sessionId: string,
): Promise<void> {
  const sid = sessionId.trim();
  if (!sid) {
    return;
  }
  const live = get().live;
  if (!live || get().connectionMode !== "live-bridge") {
    return;
  }
  const gen = (usageGeneration.get(sid) ?? 0) + 1;
  usageGeneration.set(sid, gen);
  try {
    const result = await live.tokenUsage(sid);
    if (usageGeneration.get(sid) !== gen) {
      return;
    }
    if (!result.ok) {
      return;
    }
    const parsed = parseTokenUsageRpc(result.data);
    if (!parsed) {
      return;
    }
    applyTokenUsageToStore(set, get, sid, parsed);
  } catch {
    // Transport timeout / method-not-found — keep last-known-good.
  }
}

/**
 * Write a usage snapshot onto the canvas (when this session is in view) and
 * the catalog row. Does not go through applyInboundSession (would re-arm
 * restore backfill). A non-canvas id patches only that row's `tokenUsage` —
 * plan / title / subagents / goal stay the existing object references, and
 * catalog order / `updatedAt` do not change. Missing row is a no-op.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Target session id.
 * @param usage Parsed occupancy / billed bag.
 */
export function applyTokenUsageToStore(
  set: SessionStoreSet,
  get: SessionStoreGet,
  sessionId: string,
  usage: SessionTokenUsage,
): void {
  const state = get();
  if (state.session.id === sessionId) {
    const tokenUsage = mergeBackfillUsage(usage, state.session.tokenUsage);
    if (
      tokenUsage === state.session.tokenUsage ||
      (tokenUsage.contextTokensUsed ===
        state.session.tokenUsage?.contextTokensUsed &&
        tokenUsage.inputTokens === state.session.tokenUsage?.inputTokens &&
        tokenUsage.outputTokens === state.session.tokenUsage?.outputTokens &&
        tokenUsage.totalTokens === state.session.tokenUsage?.totalTokens)
    ) {
      return;
    }
    const session = { ...state.session, tokenUsage };
    const catalog = upsertFromLiveState(state.catalog, session);
    persistNormalizedCatalog(catalog);
    set({ session, catalog });
    return;
  }
  const idx = state.catalog.findIndex((row) => row.id === sessionId);
  if (idx < 0) {
    return;
  }
  const prev = state.catalog[idx];
  if (!prev) {
    return;
  }
  const tokenUsage = mergeBackfillUsage(usage, prev.tokenUsage);
  if (tokenUsage === prev.tokenUsage) {
    return;
  }
  const catalog = [...state.catalog];
  catalog[idx] = { ...prev, tokenUsage };
  persistNormalizedCatalog(catalog);
  set({ catalog });
}

/**
 * Arm a one-shot occupancy RPC for this session when the ring has nothing
 * to show. Safe to call from the inbound hot path.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Session that just restored or settled idle.
 */
export function scheduleTokenUsageBackfill(
  set: SessionStoreSet,
  get: SessionStoreGet,
  sessionId: string,
): void {
  const sid = sessionId.trim();
  if (!sid || occupancyBackfillAttempted.has(sid)) {
    return;
  }
  occupancyBackfillAttempted.add(sid);
  void refreshSessionTokenUsageAction(set, get, sid);
}

/**
 * Inbound hook: one-shot occupancy RPC when the ring has nothing to show
 * (including a live attach after session/load dropped `_meta`). Reset the
 * latch only once occupancy exists so a later idle can refresh after compact.
 * @param set Zustand set (inbound slice; cast at the live apply site).
 * @param get Zustand get.
 * @param args Session id + follow/restore/idle flags + current usage.
 */
export function syncTokenUsageBackfillFromInbound(
  set: SessionStoreSet,
  get: SessionStoreGet,
  args: {
    sessionId: string;
    status: string;
    follow: boolean;
    restoreDone: boolean;
    tokenUsage: SessionTokenUsage | undefined;
  },
): void {
  const sid = args.sessionId.trim();
  if (!sid) {
    return;
  }
  const missing = needsOccupancyBackfill(args.tokenUsage);
  // Only reset the latch once occupancy is present so a later idle can
  // refresh after compact. Missing occupancy on a live attach must still
  // arm the one-shot RPC (session/load often drops `_meta` stamps).
  if (args.follow && args.status === "streaming" && !missing) {
    resetTokenUsageBackfill(sid);
  }
  if (missing && args.follow) {
    scheduleTokenUsageBackfill(set, get, sid);
  }
}
