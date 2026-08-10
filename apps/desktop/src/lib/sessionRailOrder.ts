/**
 * Session rail ordering within a project: pin → user drag → title
 * first-character auto-sort. Pure helpers — no React / storage. Drag order
 * outranks auto-sort; pin floats above both inside the same workspace only
 * (project folders keep their own order).
 */

import {
  compareByFirstCharAscii,
  type ProjectGroup,
  type SessionRecord,
} from "@/store/sessionCatalog";
import type { SessionRailPrefs } from "@/lib/sessionRailPrefs";

/**
 * Sort sessions by title first-character code unit (asc), stable by id.
 * @param sessions Input rows (not mutated).
 * @returns New array in auto-sort order.
 */
export function orderSessionsByTitleAscii(
  sessions: SessionRecord[],
): SessionRecord[] {
  return [...sessions].sort((a, b) =>
    compareByFirstCharAscii(a.title, b.title, a.id, b.id),
  );
}

/**
 * Apply user drag order, then title auto-sort for anything not listed.
 * Drag list ids that are missing from `sessions` are skipped; new sessions
 * not in the list sort by title ASCII after the dragged block.
 * @param sessions Sessions for one project (any prior order).
 * @param userOrder Drag order for this workspace (index 0 = top). Empty → ASCII only.
 * @returns New array; does not mutate `sessions`.
 */
export function orderSessionsByUserThenAscii(
  sessions: SessionRecord[],
  userOrder: string[] | undefined,
): SessionRecord[] {
  if (sessions.length === 0) {
    return sessions;
  }
  if (!userOrder || userOrder.length === 0) {
    return orderSessionsByTitleAscii(sessions);
  }
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const ordered: SessionRecord[] = [];
  for (const id of userOrder) {
    const rec = byId.get(id);
    if (rec) {
      ordered.push(rec);
      byId.delete(id);
    }
  }
  const rest = orderSessionsByTitleAscii([...byId.values()]);
  return [...ordered, ...rest];
}

/**
 * Order sessions inside one project: pinned ids first (prefs pin order), then
 * user drag order for the rest, then title first-character auto-sort.
 * @param sessions Sessions for one project (any prior order).
 * @param pinnedSessions Pin order from prefs (index 0 highest).
 * @param userOrder Optional drag order for this workspace.
 * @returns New array; does not mutate `sessions`.
 */
export function orderSessionsByPin(
  sessions: SessionRecord[],
  pinnedSessions: string[],
  userOrder?: string[] | undefined,
): SessionRecord[] {
  if (sessions.length === 0) {
    return sessions;
  }
  const base = orderSessionsByUserThenAscii(sessions, userOrder);
  if (pinnedSessions.length === 0) {
    return base;
  }
  const byId = new Map(base.map((s) => [s.id, s]));
  const pinned: SessionRecord[] = [];
  for (const id of pinnedSessions) {
    const rec = byId.get(id);
    if (rec) {
      pinned.push(rec);
      byId.delete(id);
    }
  }
  const rest = base.filter((s) => byId.has(s.id));
  return [...pinned, ...rest];
}

/**
 * Order sessions inside each project group (pin → drag → title ASCII).
 * Project-folder order is left unchanged — pin is per-session within its
 * workspace only; it must not float or re-rank the workspace folder itself.
 * @param groups Groups already sorted by project-name first-char ASCII.
 * @param pinnedSessions Pin order from prefs (index 0 highest).
 * @param sessionOrderByWorkspace Per-workspace drag order map.
 * @returns New array of groups with in-group session order applied; does not
 *   mutate input or reorder groups relative to each other.
 */
export function orderGroupsBySessionPin(
  groups: ProjectGroup[],
  pinnedSessions: string[],
  sessionOrderByWorkspace: Record<string, string[]> = {},
): ProjectGroup[] {
  if (groups.length === 0) {
    return groups;
  }
  return groups.map((g) => ({
    ...g,
    sessions: orderSessionsByPin(
      g.sessions,
      pinnedSessions,
      sessionOrderByWorkspace[g.workspace],
    ),
  }));
}

/**
 * Move one session id to another session's index inside a full ordered id list.
 * Used after a drag-drop on the rail; result is stored as the workspace order.
 * @param orderedIds Current top-to-bottom ids for the project (all visible rows).
 * @param fromId Dragged session id.
 * @param toId Drop target session id (fromId is inserted at toId's index).
 * @returns New id list, or the original array when ids are missing / identical.
 */
export function moveSessionIdInOrder(
  orderedIds: string[],
  fromId: string,
  toId: string,
): string[] {
  if (fromId === toId || orderedIds.length === 0) {
    return orderedIds;
  }
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) {
    return orderedIds;
  }
  const next = orderedIds.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromId);
  return next;
}

/**
 * Persist a workspace's full session order after a user drag.
 * Also rewrites pin order for any pinned ids that appear in the new list so
 * pin rank stays consistent with the dragged positions among pinned rows.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key for the project group.
 * @param orderedIds Full top-to-bottom session ids after the drop.
 * @returns New prefs with drag order (and pin order if needed) updated.
 */
export function applyWorkspaceSessionOrder(
  prefs: SessionRailPrefs,
  workspace: string,
  orderedIds: string[],
): SessionRailPrefs {
  const clean = uniqueOrderIds(orderedIds);
  const sessionOrderByWorkspace = {
    ...prefs.sessionOrderByWorkspace,
    [workspace]: clean,
  };
  // Keep pin relative order aligned with the dragged layout for pinned ids.
  const pinSet = new Set(prefs.pinnedSessions);
  const pinnedInOrder = clean.filter((id) => pinSet.has(id));
  const pinnedRest = prefs.pinnedSessions.filter((id) => !clean.includes(id));
  return {
    ...prefs,
    sessionOrderByWorkspace,
    pinnedSessions: [...pinnedInOrder, ...pinnedRest],
  };
}

/**
 * Dedupe id lists while preserving first-seen order (empty strings dropped).
 * @param value Candidate ordered ids.
 * @returns Clean top-to-bottom id list.
 */
function uniqueOrderIds(value: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}
