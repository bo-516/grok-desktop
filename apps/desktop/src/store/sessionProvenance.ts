/**
 * Session provenance whitelist: only locally requested ids enter the catalog/rail.
 *
 * Wire-only ids (first seen on the network, never created/resumed/listed by this
 * client) stay in an in-memory pending buffer until claimed as child, disk, or
 * flush. This removes the mid-fanout rail pollution window that passive
 * retro-tagging could not close (parent may emit zero frames during child fanout).
 */


/** How a session id entered the desktop client. Default when missing is wire. */
export type SessionProvenance =
  | "local"
  | "resumed"
  | "disk"
  | "child"
  | "wire";

/** sessionId → provenance. Wire entries are never persisted. */
export type SessionProvenanceIndex = Record<string, SessionProvenance>;

/**
 * Whether this provenance may enter the catalog and session rail.
 * Undefined is treated as wire (most conservative).
 * @param p Provenance stamp, or undefined when unknown.
 * @returns True for local / resumed / disk only.
 */
export function isUserFacingProvenance(
  p: SessionProvenance | undefined,
): boolean {
  return p === "local" || p === "resumed" || p === "disk";
}

/**
 * Stamp one id with a provenance, returning a new index when the value changes.
 * Higher-priority stamps (local/resumed/disk/child) must not be downgraded to wire.
 * @param index Current provenance map.
 * @param id Session id to stamp.
 * @param next New provenance.
 * @returns Same reference when unchanged; otherwise a new map.
 */
export function stampProvenance(
  index: SessionProvenanceIndex | undefined,
  id: string,
  next: SessionProvenance,
): SessionProvenanceIndex {
  const base = index ?? {};
  if (!id) {
    return base;
  }
  const prev = base[id];
  if (prev === next) {
    return base;
  }
  // Never downgrade a user-facing or child stamp back to wire.
  if (next === "wire" && prev && prev !== "wire") {
    return base;
  }
  // Child may reclaim a race-stamped `local` (forceNew window mis-stamp on a
  // background/wire id). Do not override resumed/disk — those are explicit
  // user opens / list sync of ordinary chats.
  if (next === "child" && (prev === "resumed" || prev === "disk")) {
    return base;
  }
  return { ...base, [id]: next };
}

/**
 * Stamp many ids with the same provenance.
 * @param index Current map.
 * @param ids Session ids.
 * @param next Provenance to apply.
 * @returns Updated map (same ref when nothing changed).
 */
export function stampProvenanceMany(
  index: SessionProvenanceIndex,
  ids: string[],
  next: SessionProvenance,
): SessionProvenanceIndex {
  let out = index;
  for (const id of ids) {
    out = stampProvenance(out, id, next);
  }
  return out;
}

/**
 * Rebuild provenance from a hydrated catalog (post-migration).
 * Subagent-kind rows → child; everything else with an id → disk.
 * @param catalog Persisted rows (may include tagged children).
 * @returns Provenance index (no wire entries).
 */
export function provenanceFromCatalog(
  catalog: Array<{ id: string; sessionKind?: string }>,
): SessionProvenanceIndex {
  const out: SessionProvenanceIndex = {};
  for (const rec of catalog) {
    if (!rec.id) {
      continue;
    }
    if (
      typeof rec.sessionKind === "string" &&
      rec.sessionKind.startsWith("subagent")
    ) {
      out[rec.id] = "child";
    } else {
      out[rec.id] = "disk";
    }
  }
  return out;
}

/** Max pending (unproven) session buffers kept in memory. */
export const PENDING_SESSIONS_MAX = 64;

/**
 * Insert or replace a pending session; when over capacity, returns the oldest
 * entry that must be flushed to catalog before eviction (caller must not drop it).
 * @param pending Current pending map.
 * @param id Session id.
 * @param state SessionState buffer for that id.
 * @param order Insertion order list (oldest first); copy returned.
 * @returns next pending map, next order, and optional flushed victim.
 */
export function putPendingSession<T>(
  pending: Record<string, T>,
  id: string,
  state: T,
  order: string[],
): {
  pending: Record<string, T>;
  order: string[];
  evictId: string | null;
  /** State of the evicted id (flush this before dropping). */
  evicted: T | null;
} {
  if (!id) {
    return { pending, order, evictId: null, evicted: null };
  }
  const nextOrder = order.includes(id) ? order : [...order, id];
  const nextPending = { ...pending, [id]: state };
  if (nextOrder.length <= PENDING_SESSIONS_MAX) {
    return {
      pending: nextPending,
      order: nextOrder,
      evictId: null,
      evicted: null,
    };
  }
  // Evict oldest that is not the id we just wrote.
  const evictId = nextOrder.find((x) => x !== id) ?? nextOrder[0] ?? null;
  if (!evictId || evictId === id) {
    return {
      pending: nextPending,
      order: nextOrder,
      evictId: null,
      evicted: null,
    };
  }
  const evicted = nextPending[evictId] ?? pending[evictId] ?? null;
  const { [evictId]: _drop, ...rest } = nextPending;
  return {
    pending: rest,
    order: nextOrder.filter((x) => x !== evictId),
    evictId,
    evicted,
  };
}

/**
 * Remove one id from pending map + order.
 * @param pending Pending buffers.
 * @param order Oldest-first order.
 * @param id Id to drop.
 * @returns Updated pending + order (same refs when id absent).
 */
export function takePendingSession<T>(
  pending: Record<string, T>,
  order: string[],
  id: string,
): { pending: Record<string, T>; order: string[]; taken: T | undefined } {
  if (!(id in pending)) {
    return { pending, order, taken: undefined };
  }
  const { [id]: taken, ...rest } = pending;
  return {
    pending: rest,
    order: order.filter((x) => x !== id),
    taken,
  };
}

/**
 * Node/Go forceNew handshake ready text after OUR session/new.
 * Covers `session <id> ready` and `session <id> ready (models=…)`.
 * Rejects recovery/ops info (`agent process exited…`, `restarted session…`).
 */
export const FORCE_NEW_READY_INFO_RE = /^session\s+\S+\s+ready\b/i;

/**
 * Whether a bridge `info` frame may stamp `local` for forceNew.
 * Requires draft create flags, a sessionId, AND the shipped ready message
 * text — bare sessionId during create is not enough (pool/recovery/ops info
 * for unrelated ids must not become sticky local mid-forceNew).
 *
 * @param args Draft create flags + info sessionId + info message text.
 * @returns True when sessionId should be stamped local.
 */
export function shouldStampLocalFromForceNewInfo(args: {
  creatingSession: boolean;
  localDraft: boolean;
  sessionId: string | undefined | null;
  /** Bridge info.message; must match {@link FORCE_NEW_READY_INFO_RE}. */
  message: string | undefined | null;
}): boolean {
  if (!args.creatingSession || !args.localDraft) {
    return false;
  }
  if (!args.sessionId?.trim()) {
    return false;
  }
  const msg = (args.message ?? "").trim();
  if (!msg) {
    return false;
  }
  return FORCE_NEW_READY_INFO_RE.test(msg);
}
