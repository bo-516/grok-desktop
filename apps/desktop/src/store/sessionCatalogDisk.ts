/**
 * Rail membership from a successful `sessions_list` (disk under ~/.grok/sessions).
 * Pure — no React, no localStorage. In-memory rows that disk still lists keep
 * their timeline and locked title; ids disk no longer has are dropped unless
 * the caller marks them live (a turn or pool process that has not flushed yet).
 */

import {
  mergeRemoteSessionsIntoCatalog,
  type RemoteSessionRow,
} from "../lib/sessionActions";
import {
  formatRelativeTime,
  normalizeCatalog,
  type SessionRecord,
} from "./sessionCatalog";

/**
 * Whether two optional strings paint the same rail value.
 * Missing and empty are the same: disk omits sessionKind on ordinary chats.
 * @param before Value currently on the row.
 * @param after Value after this disk read.
 * @returns True when the rail would show the same text.
 */
function sameRailText(before?: string, after?: string): boolean {
  return (before ?? "") === (after ?? "");
}

/**
 * Whether one row would look the same on the rail.
 * `updatedAt` counts only when the relative label ("1mo", "2m") would change.
 * A newer file mtime inside the same label must not repaint the row.
 * @param before Row currently shown.
 * @param after Row produced by this disk read.
 * @param now Wall clock used for the relative label. Both sides share one value.
 * @returns True when title, project, role, and the time label match.
 */
export function railRowViewSame(
  before: SessionRecord,
  after: SessionRecord,
  now: number,
): boolean {
  return (
    before.id === after.id &&
    before.title === after.title &&
    before.workspace === after.workspace &&
    sameRailText(before.sessionKind, after.sessionKind) &&
    sameRailText(before.parentSessionId, after.parentSessionId) &&
    Boolean(before.noProject) === Boolean(after.noProject) &&
    formatRelativeTime(before.updatedAt, now) ===
      formatRelativeTime(after.updatedAt, now)
  );
}

/**
 * True when two catalogs would paint the same rail, in the same order.
 * Idle refresh uses this to skip a store write. Same order plus the same
 * relative time label means a raw `updatedAt` bump is not a visible change.
 * @param prev Catalog currently in the store.
 * @param next Catalog after the disk reconcile.
 * @param now Wall clock for relative labels. Defaults to `Date.now()`.
 * @returns True when every visible row matches in place.
 */
export function catalogListUnchanged(
  prev: SessionRecord[],
  next: SessionRecord[],
  now = Date.now(),
): boolean {
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i += 1) {
    const before = prev[i];
    const after = next[i];
    if (!before || !after || !railRowViewSame(before, after, now)) {
      return false;
    }
  }
  return true;
}

/**
 * Keep the previous catalog reference when the rail would not change.
 * Unchanged rows keep their object identity so a later partial write does
 * not hand every row a new record. Callers must skip `set` when the return
 * value is `prev` — a new array always re-renders the list.
 * @param prev Catalog currently shown.
 * @param next Catalog after reconcile. Not mutated.
 * @param now Wall clock for relative labels.
 * @returns `prev` when the view is unchanged; otherwise a list that reuses
 *   unchanged row objects.
 */
export function stabilizeCatalogView(
  prev: SessionRecord[],
  next: SessionRecord[],
  now = Date.now(),
): SessionRecord[] {
  if (prev === next || catalogListUnchanged(prev, next, now)) {
    return prev;
  }
  const prevById = new Map(prev.map((row) => [row.id, row]));
  const sameLength = prev.length === next.length;
  const settled: SessionRecord[] = [];
  let identical = sameLength;
  for (let i = 0; i < next.length; i += 1) {
    const row = next[i];
    if (!row) {
      identical = false;
      continue;
    }
    const old = prevById.get(row.id);
    if (old && railRowViewSame(old, row, now)) {
      settled.push(old);
      if (prev[i] !== old) {
        identical = false;
      }
    } else {
      settled.push(row);
      identical = false;
    }
  }
  if (identical) {
    return prev;
  }
  return settled;
}

/**
 * Fields the sync path uses to decide which in-memory ids may outlive disk.
 * A missing or idle id is not kept: the next refresh removes it from the rail.
 */
export type CatalogKeepSource = {
  /** Pending wire buffers not yet claimed by a disk row. */
  pendingSessionIds?: readonly string[];
  /** Resident pool processes. Only `live === true` is kept. */
  poolEntries?: ReadonlyArray<{ sessionId: string; live?: boolean }>;
  /** True while the first send of a New chat is still creating the session. */
  creatingSession?: boolean;
  /** Canvas session id, when one is painted. */
  sessionId?: string;
  /** Canvas status. streaming / waiting_permission count as busy. */
  sessionStatus?: string;
};

/**
 * Ids that a successful disk read must not drop.
 * Pending buffers, a live pool process, and a canvas that is still creating
 * or mid-turn can exist before `~/.grok/sessions` has a folder for them.
 * @param source Snapshot of pending / pool / canvas. Omitted fields keep nothing.
 * @returns Set of session ids to retain even when absent from `sessions_list`.
 */
export function catalogKeepIds(source: CatalogKeepSource): Set<string> {
  const keep = new Set<string>();
  for (const id of source.pendingSessionIds ?? []) {
    if (id) {
      keep.add(id);
    }
  }
  for (const entry of source.poolEntries ?? []) {
    if (entry.live === true && entry.sessionId) {
      keep.add(entry.sessionId);
    }
  }
  const sessionId = source.sessionId?.trim() ?? "";
  const busy =
    source.creatingSession === true ||
    source.sessionStatus === "streaming" ||
    source.sessionStatus === "waiting_permission";
  if (sessionId && busy) {
    keep.add(sessionId);
  }
  return keep;
}

/**
 * Replace rail membership with a successful disk listing.
 * Rows present on both sides keep the in-memory timeline, locked title, and
 * no-project flag (mergeRemoteSessionsIntoCatalog). Rows missing from disk
 * are removed unless `keepIds` names them. An empty `rows` array clears
 * every id that is not kept — a deleted sessions directory is an empty rail.
 * @param catalog Current in-memory catalog. Not mutated.
 * @param rows Normalized `sessions_list` rows. Empty means disk has no sessions.
 * @param keepIds Ids that may stay when disk does not list them. Empty drops all.
 * @returns Next catalog. Same reference as `catalog` only when merge and the
 *   filter both leave the input unchanged (merge's own empty-remote short circuit
 *   plus a keep set that already covers every row).
 */
export function reconcileCatalogWithDisk(
  catalog: SessionRecord[],
  rows: RemoteSessionRow[],
  keepIds: ReadonlySet<string>,
): SessionRecord[] {
  const merged = mergeRemoteSessionsIntoCatalog(catalog, rows);
  const remoteIds = new Set<string>();
  for (const row of rows) {
    remoteIds.add(row.id);
  }
  const next = merged.filter(
    (rec) => remoteIds.has(rec.id) || keepIds.has(rec.id),
  );
  if (next.length === merged.length) {
    return merged;
  }
  return normalizeCatalog(next);
}
