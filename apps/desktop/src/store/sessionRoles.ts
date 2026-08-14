/**
 * Session role index: childSessionId → parent + kind.
 *
 * Built from live `subagent_spawned` cards (first-hand, before disk sync) and
 * from `sessions_list` remote rows (history / offline). Used to (1) filter the
 * session rail and Overview, (2) retro-tag catalog rows created out of order,
 * and (3) route child streaming updates into the low-frequency childSessions
 * buffer.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import { isSubagentSessionKind, type RemoteSessionRow } from "@/lib/sessionActions";
import type { SessionRecord } from "./sessionCatalogTypes";

/** Child-session role entry under its parent chat. */
export type SessionRoleEntry = {
  /** Parent chat session id that spawned this child. */
  parentSessionId: string;
  /** Always subagent for harness-spawned children (prefix-match family). */
  sessionKind: "subagent";
};

/** childSessionId → role entry. Cross-session; rebuilt from catalog + live. */
export type SessionRoleIndex = Record<string, SessionRoleEntry>;

/**
 * Extract child-session roles from a reduced parent SessionState.
 * Parent's own id is never indexed as a child of itself.
 * @param state Parent (or any) session after orchestration reduce.
 * @returns Role index for every card that has a childSessionId.
 */
export function rolesFromSubagents(state: SessionState): SessionRoleIndex {
  const out: SessionRoleIndex = {};
  const parentId = state.id;
  const cards = state.subagents;
  if (!cards) {
    return out;
  }
  for (const card of Object.values(cards)) {
    const childId = card.childSessionId?.trim();
    if (!childId) {
      continue;
    }
    // Never mark the parent row as its own subagent.
    if (parentId && childId === parentId) {
      continue;
    }
    out[childId] = {
      parentSessionId: parentId || card.subagentId,
      sessionKind: "subagent",
    };
  }
  return out;
}

/**
 * Extract roles from sessions_list / disk enumeration rows.
 * Kind alone is enough to mark non-user sessions; parent is optional
 * (disk summary.json often lacks parent_session_id — only meta.json under
 * the parent has it). Missing parent must not drop the id from the index.
 * @param rows Normalized remote session rows.
 * @returns Role index for harness-spawned children.
 */
export function rolesFromRemoteRows(rows: RemoteSessionRow[]): SessionRoleIndex {
  const out: SessionRoleIndex = {};
  for (const row of rows) {
    if (!isSubagentSessionKind(row.sessionKind)) {
      continue;
    }
    const parent = row.parentSessionId?.trim() ?? "";
    out[row.id] = {
      parentSessionId: parent,
      sessionKind: "subagent",
    };
  }
  return out;
}

/**
 * Rebuild a role index from catalog rows (sessionKind + parent subagents).
 * Used on hydrate so live routing works before the next spawn event.
 * @param catalog Persisted catalog including orchestration snapshots.
 * @returns Merged role index.
 */
export function rolesFromCatalog(catalog: SessionRecord[]): SessionRoleIndex {
  let out: SessionRoleIndex = {};
  for (const rec of catalog) {
    if (isSubagentSessionKind(rec.sessionKind) && rec.parentSessionId) {
      out[rec.id] = {
        parentSessionId: rec.parentSessionId,
        sessionKind: "subagent",
      };
    }
    if (rec.subagents && Object.keys(rec.subagents).length > 0) {
      out = mergeRoles(
        out,
        rolesFromSubagents({
          id: rec.id,
          workspace: rec.workspace,
          model: rec.model,
          mode: rec.mode,
          status: rec.status,
          timeline: rec.timeline,
          toolCalls: rec.toolCalls,
          lastAgentText: rec.lastAgentText,
          subagents: rec.subagents,
        }),
      );
    }
  }
  return out;
}

/**
 * Shallow-merge role indexes; later sources win on same child id.
 * Disk history and live spawns are complementary, not exclusive.
 * @param bases Role indexes in ascending priority (last wins).
 * @returns Combined index.
 */
export function mergeRoles(...bases: SessionRoleIndex[]): SessionRoleIndex {
  const out: SessionRoleIndex = {};
  for (const base of bases) {
    for (const [id, entry] of Object.entries(base)) {
      out[id] = entry;
    }
  }
  return out;
}

/**
 * Patch catalog rows whose id is known to be a child session.
 * Covers the out-of-order case: child frame created a row before subagent_spawned.
 * Also stamps parent workspace when the child row still has empty workspace
 * (bucket starts with workspace: "" → noProject stickiness).
 * @param catalog Current catalog (not mutated).
 * @param roles Role index including freshly merged live roles.
 * @param parentById Optional parent id → workspace for noProject heal.
 * @returns Catalog with sessionKind / parentSessionId / workspace patched; same
 *   array reference when nothing changed.
 */
export function retroTagCatalogRoles(
  catalog: SessionRecord[],
  roles: SessionRoleIndex,
  parentById?: Record<string, string>,
): SessionRecord[] {
  if (Object.keys(roles).length === 0) {
    return catalog;
  }
  let changed = false;
  const next = catalog.map((rec) => {
    const role = roles[rec.id];
    if (!role) {
      return rec;
    }
    const parentWs = parentById?.[role.parentSessionId];
    const needKind = !isSubagentSessionKind(rec.sessionKind);
    const needParent =
      !rec.parentSessionId || rec.parentSessionId !== role.parentSessionId;
    const needWs =
      Boolean(parentWs) &&
      (!rec.workspace.trim() || Boolean(rec.noProject));
    if (!needKind && !needParent && !needWs) {
      return rec;
    }
    changed = true;
    return {
      ...rec,
      sessionKind: needKind ? role.sessionKind : rec.sessionKind,
      parentSessionId: role.parentSessionId,
      ...(needWs && parentWs
        ? { workspace: parentWs, noProject: false }
        : {}),
    };
  });
  return changed ? next : catalog;
}

/**
 * Whether a subagent card is in a terminal status (promote child to catalog).
 * @param status Card status string from subagent_finished / spawn.
 * @returns True for completed / failed / cancelled (and common aliases).
 */
export function isTerminalSubagentStatus(status: string | undefined): boolean {
  if (!status) {
    return false;
  }
  const s = status.toLowerCase();
  return (
    s === "completed" ||
    s === "failed" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "error"
  );
}

/**
 * Child session ids that should be promoted from the in-memory buffer into the
 * catalog because their parent card reached a terminal status.
 * @param state Parent session with subagents map.
 * @returns childSessionIds ready for promote.
 */
export function terminalChildSessionIds(state: SessionState): string[] {
  const cards = state.subagents;
  if (!cards) {
    return [];
  }
  const ids: string[] = [];
  for (const card of Object.values(cards)) {
    if (
      isTerminalSubagentStatus(card.status) &&
      card.childSessionId?.trim()
    ) {
      ids.push(card.childSessionId.trim());
    }
  }
  return ids;
}

/**
 * Promote one buffered child session into the catalog with role + parent workspace.
 * Does not advance recency for an existing row (rail stays calm on terminal flush).
 * @param catalog Current catalog.
 * @param child Healed child SessionState from childSessions buffer.
 * @param role Role entry (parent + kind).
 * @param parentWorkspace Workspace inherited from the parent chat.
 * @param now Wall-clock for brand-new row timestamps.
 * @returns Catalog after upsert with role fields stamped.
 */
export function promoteChildToCatalog(
  catalog: SessionRecord[],
  child: SessionState,
  role: SessionRoleEntry,
  parentWorkspace: string,
  now = Date.now(),
): SessionRecord[] {
  const existing = catalog.find((s) => s.id === child.id);
  const workspace =
    child.workspace.trim() ||
    parentWorkspace ||
    existing?.workspace ||
    "";
  const title =
    (child.title && child.title.trim()) ||
    existing?.title ||
    child.id.slice(0, 8);
  const rec: SessionRecord = {
    id: child.id,
    workspace,
    title,
    mode: child.mode || existing?.mode || "build",
    model: child.model || existing?.model || "",
    status: child.status,
    createdAt: existing?.createdAt ?? now,
    // Keep prior recency when the row already exists so promote does not reorder.
    updatedAt: existing?.updatedAt ?? now,
    timeline:
      child.timeline.length > 0 ? child.timeline : existing?.timeline ?? [],
    toolCalls:
      Object.keys(child.toolCalls).length > 0
        ? child.toolCalls
        : existing?.toolCalls ?? {},
    plan: child.plan ?? existing?.plan,
    lastAgentText: child.lastAgentText || existing?.lastAgentText || "",
    sessionKind: role.sessionKind,
    parentSessionId: role.parentSessionId,
    noProject: workspace ? false : existing?.noProject,
    subagents: child.subagents ?? existing?.subagents,
    subagentLinks: child.subagentLinks ?? existing?.subagentLinks,
    backgroundTasks: child.backgroundTasks ?? existing?.backgroundTasks,
    goal: child.goal ?? existing?.goal,
  };
  const without = catalog.filter((s) => s.id !== child.id);
  return [rec, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Flush every buffered child that has a role entry into the catalog.
 * Used on catalog flush / disconnect so L3 drill-down can resolve offline.
 * @param catalog Current catalog.
 * @param childSessions In-memory child reduce buffers.
 * @param roles Role index.
 * @param parentWorkspaceById parentSessionId → workspace for inheritance.
 * @returns { catalog, remaining } after promote; remaining keeps unscoped children.
 */
export function flushChildSessionsToCatalog(
  catalog: SessionRecord[],
  childSessions: Record<string, SessionState>,
  roles: SessionRoleIndex,
  parentWorkspaceById: Record<string, string>,
): {
  catalog: SessionRecord[];
  remaining: Record<string, SessionState>;
} {
  let nextCatalog = catalog;
  const remaining: Record<string, SessionState> = {};
  for (const [id, child] of Object.entries(childSessions)) {
    const role = roles[id];
    if (!role) {
      remaining[id] = child;
      continue;
    }
    nextCatalog = promoteChildToCatalog(
      nextCatalog,
      child,
      role,
      parentWorkspaceById[role.parentSessionId] ?? "",
    );
  }
  return { catalog: nextCatalog, remaining };
}
