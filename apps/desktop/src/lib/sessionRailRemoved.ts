/**
 * "Remove project" for the session rail: pure mark / hide / revive rules.
 *
 * Why a pref and not a delete: rail project folders are catalog rows
 * grouped by workspace, and grok-build's `sessions_list` re-merges those
 * rows on every connect. Dropping them locally would not stick, and deleting
 * them upstream would lose the chats. So removal only marks the folder and
 * the rail filters it out at render time; nothing on disk changes.
 *
 * Revive rule: a removed folder stays hidden only while none of its chats
 * was created after the removal. Starting a chat in that folder again (the
 * composer's project switcher, Create project with the same path, or grok
 * run in a terminal there) brings the folder back with every old chat, pin,
 * and drag order. The rail then forgets the mark
 * ({@link forgetRemovedWorkspaces}) so deleting that new chat later does
 * not hide the folder again.
 *
 * Scope: project rows only. "No project" chats (`isNoProjectSession`) are
 * never hidden and never revive a folder, even when the bridge filed them
 * under that folder's path. Callers judge revival on rail-visible rows
 * (subagents and empty drafts stripped) so a background child chat cannot
 * bring a folder back.
 */

import {
  normalizeWorkspaceKey,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";
import {
  isNoProjectSession,
  NO_PROJECT_KEY,
  type SessionRecord,
} from "@/store/sessionCatalog";

/** Session statuses that mean the agent is still working in a chat. */
const BUSY_STATUSES = new Set(["streaming", "waiting_permission"]);

/** Removed folders split by whether the rail still hides them. */
export type RemovedWorkspaceState = {
  /** Normalized folder keys the rail must not render. */
  hidden: ReadonlySet<string>;
  /**
   * Normalized keys whose folder came back (a chat newer than the removal
   * exists). The caller should forget these marks.
   */
  revived: string[];
};

/**
 * Whether a row belongs to the given project folder.
 * @param rec Catalog row.
 * @param workspace Folder path or normalized key (trailing slash ok).
 * @returns False for no-project rows even when their path matches.
 */
export function isRowInProject(rec: SessionRecord, workspace: string): boolean {
  return (
    !isNoProjectSession(rec) &&
    normalizeWorkspaceKey(rec.workspace) === normalizeWorkspaceKey(workspace)
  );
}

/**
 * Record "Remove project" for one folder. Removing again refreshes the
 * time, so a folder that came back can be removed again.
 * @param prefs Current prefs (not mutated).
 * @param workspace Folder path as grouped on the rail (trailing slash ok).
 * @param now Removal time in epoch ms (injectable for tests).
 * @returns New prefs with the mark; an empty path or the no-project key
 *   returns `prefs` unchanged (there is no folder to remove).
 */
export function markWorkspaceRemoved(
  prefs: SessionRailPrefs,
  workspace: string,
  now: number = Date.now(),
): SessionRailPrefs {
  const key = normalizeWorkspaceKey(workspace.trim());
  if (key === NO_PROJECT_KEY) {
    return prefs;
  }
  return {
    ...prefs,
    removedWorkspaces: { ...prefs.removedWorkspaces, [key]: now },
  };
}

/**
 * Drop removal marks for folders that came back.
 * @param prefs Current prefs (not mutated).
 * @param keys Normalized keys, typically {@link RemovedWorkspaceState.revived}.
 * @returns `prefs` itself when none of the keys is marked (nothing to
 *   write), otherwise new prefs without those marks.
 */
export function forgetRemovedWorkspaces(
  prefs: SessionRailPrefs,
  keys: readonly string[],
): SessionRailPrefs {
  const drop = new Set(
    keys.filter((key) => Object.hasOwn(prefs.removedWorkspaces, key)),
  );
  if (drop.size === 0) {
    return prefs;
  }
  return {
    ...prefs,
    removedWorkspaces: Object.fromEntries(
      Object.entries(prefs.removedWorkspaces).filter(([key]) => !drop.has(key)),
    ),
  };
}

/**
 * Split removed folders into still-hidden and revived.
 * @param rows Rail-visible rows without the search filter — revival must
 *   see every chat in the folder, not just the matches.
 * @param removed `prefs.removedWorkspaces` (normalized key → epoch ms).
 * @returns Hidden keys and revived keys; both empty when nothing is removed.
 */
export function resolveRemovedWorkspaces(
  rows: readonly SessionRecord[],
  removed: Readonly<Record<string, number>>,
): RemovedWorkspaceState {
  const revived = new Set(
    rows
      .filter((rec) => !isNoProjectSession(rec))
      .map((rec) => ({
        key: normalizeWorkspaceKey(rec.workspace),
        createdAt: rec.createdAt,
      }))
      .filter(
        ({ key, createdAt }) =>
          Object.hasOwn(removed, key) && createdAt > (removed[key] ?? 0),
      )
      .map(({ key }) => key),
  );
  return {
    hidden: new Set(Object.keys(removed).filter((key) => !revived.has(key))),
    revived: [...revived],
  };
}

/**
 * Drop the rows of hidden project folders. No-project rows always stay.
 * @param rows Catalog rows at any filter stage.
 * @param hidden Keys from {@link resolveRemovedWorkspaces}.
 * @returns `rows` itself when nothing is hidden (keeps memo identity),
 *   otherwise a filtered copy.
 */
export function dropHiddenProjectRows<T extends SessionRecord>(
  rows: T[],
  hidden: ReadonlySet<string>,
): T[] {
  if (hidden.size === 0) {
    return rows;
  }
  return rows.filter(
    (rec) =>
      isNoProjectSession(rec) ||
      !hidden.has(normalizeWorkspaceKey(rec.workspace)),
  );
}

/**
 * Whether a live status means the agent is still working (streaming a
 * reply or waiting for a permission answer).
 * @param status Live session status; undefined when the chat has no process.
 */
export function isBusySessionStatus(status: string | undefined): boolean {
  return status !== undefined && BUSY_STATUSES.has(status);
}

/**
 * Project folders with a chat the agent is still working on. "Remove
 * project" is disabled for these so a running chat or a pending approval
 * never disappears from the rail.
 * @param rows Rail-visible rows.
 * @param statusOf Live status of a row (pool process / active session), or
 *   undefined when it has none — stale catalog statuses must not count.
 * @returns Normalized keys of busy folders.
 */
export function busyWorkspaceKeys(
  rows: readonly SessionRecord[],
  statusOf: (rec: SessionRecord) => string | undefined,
): Set<string> {
  return new Set(
    rows
      .filter(
        (rec) => !isNoProjectSession(rec) && isBusySessionStatus(statusOf(rec)),
      )
      .map((rec) => normalizeWorkspaceKey(rec.workspace)),
  );
}

/**
 * Chat to open after the viewed chat's folder is removed: the most recently
 * active rail row outside that folder (same pick as deleting the open chat).
 * @param rows Rail-visible rows, already without hidden folders.
 * @param workspace Folder being removed.
 * @returns Session id, or null when nothing else is on the rail.
 */
export function nextChatAfterRemoval(
  rows: readonly SessionRecord[],
  workspace: string,
): string | null {
  const next = rows
    .filter((rec) => !isRowInProject(rec, workspace))
    .reduce<SessionRecord | null>(
      (best, rec) => (!best || rec.updatedAt > best.updatedAt ? rec : best),
      null,
    );
  return next?.id ?? null;
}
