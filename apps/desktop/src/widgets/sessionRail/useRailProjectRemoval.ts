/**
 * "Remove project" wiring for the session rail — a sub-hook composed by
 * useSessionRailWidget (kept separate so that hook stays under the line
 * cap). It connects the pure rules in `@/lib/sessionRailRemoved` to the
 * rail prefs and the session store:
 *  - the catalog without hidden folders (what the rail groups and counts),
 *  - a busy guard (no removal while a chat in the folder is running),
 *  - the remove action (mark the folder, clear it as the default project,
 *    move off its open chat),
 *  - forgetting the mark once the folder comes back.
 * Nothing here deletes chats; grok-build's session files are untouched.
 */

import { useCallback, useEffect, useMemo } from "react";
import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import {
  normalizeWorkspaceKey,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";
import {
  busyWorkspaceKeys,
  dropHiddenProjectRows,
  forgetRemovedWorkspaces,
  isRowInProject,
  markWorkspaceRemoved,
  nextChatAfterRemoval,
  resolveRemovedWorkspaces,
} from "@/lib/sessionRailRemoved";
import {
  forgetActiveWorkspace,
  loadWorkspacePrefs,
  saveWorkspacePrefs,
} from "@/lib/workspacePrefs";
import type { SessionRecord } from "@/store/sessionCatalog";
import { useSessionStore } from "@/store/sessionStore";

/** Inputs from useSessionRailWidget. */
export type RailProjectRemovalInput = {
  /** Full session catalog from the store (subagent rows included). */
  catalog: SessionRecord[];
  /** Rail prefs; removal marks live in `removedWorkspaces`. */
  railPrefs: SessionRailPrefs;
  /**
   * Functional prefs writer that also persists. A writer that does not
   * save leaves removals in memory only, lost on reload.
   */
  commitRailPrefs: (
    updater: (prev: SessionRailPrefs) => SessionRailPrefs,
  ) => void;
  /** Live status by session id for pooled (background) processes. */
  poolStatusById: ReadonlyMap<string, string>;
};

/** Joins revived keys into one effect dependency; never occurs in a path. */
const KEY_SEPARATOR = "\u0000";

/**
 * Hidden-folder filter, busy guard, and "Remove project" for the rail.
 * @param input Catalog, prefs + persisting writer, and pool status.
 * @returns `visibleCatalog` (catalog minus hidden folders — group and
 *   search this, not the raw catalog), `catalogLength` (rail chats outside
 *   hidden folders, for the footer), `onRemoveProject(workspace)`, and
 *   `isProjectBusy(workspace)` (true disables the menu item).
 */
export function useRailProjectRemoval(input: RailProjectRemovalInput) {
  const { catalog, railPrefs, commitRailPrefs, poolStatusById } = input;
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  /** Chat on the canvas (viewing wins over the live one), or null. */
  const selectedId = useSessionStore(
    (s) => s.viewingSessionId ?? s.activeSessionId,
  );
  const liveStatus = useSessionStore((s) => s.session.status);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);

  /** Rail-visible chats without the search filter; removal is judged here. */
  const railRows = useMemo(
    () => filterCatalogForSessionRail(catalog),
    [catalog],
  );
  /** Which removed folders stay hidden and which came back. */
  const removed = useMemo(
    () => resolveRemovedWorkspaces(railRows, railPrefs.removedWorkspaces),
    [railRows, railPrefs.removedWorkspaces],
  );
  /** Catalog without hidden folders (same array when nothing is hidden). */
  const visibleCatalog = useMemo(
    () => dropHiddenProjectRows(catalog, removed.hidden),
    [catalog, removed.hidden],
  );
  /** Footer "Sessions N": rail chats outside hidden folders. */
  const catalogLength = useMemo(
    () => dropHiddenProjectRows(railRows, removed.hidden).length,
    [railRows, removed.hidden],
  );
  /**
   * Folders with a streaming / waiting chat. Only live statuses count (pool
   * process, or the active session); stale catalog statuses do not.
   */
  const busyKeys = useMemo(
    () =>
      busyWorkspaceKeys(
        railRows,
        (rec) =>
          poolStatusById.get(rec.id) ??
          (rec.id === activeSessionId ? liveStatus : undefined),
      ),
    [railRows, poolStatusById, activeSessionId, liveStatus],
  );
  /** Revived keys as one string so the effect runs once per change. */
  const revivedKey = removed.revived.join(KEY_SEPARATOR);

  useEffect(() => {
    // A folder came back (newer chat): forget its mark so deleting that
    // chat later cannot hide the folder again.
    if (!revivedKey) {
      return;
    }
    commitRailPrefs((prev) =>
      forgetRemovedWorkspaces(prev, revivedKey.split(KEY_SEPARATOR)),
    );
  }, [revivedKey, commitRailPrefs]);

  /**
   * Whether "Remove project" must stay disabled for a folder.
   * @param workspace Folder path as grouped on the rail.
   */
  const isProjectBusy = useCallback(
    (workspace: string) => busyKeys.has(normalizeWorkspaceKey(workspace)),
    [busyKeys],
  );

  /**
   * Take a folder off the rail. No-op while it is busy. Clears it as the
   * default project, and when the open chat lives in it, opens the most
   * recent other chat — or a no-project draft when none is left.
   * @param workspace Folder path as grouped on the rail.
   */
  const onRemoveProject = useCallback(
    (workspace: string) => {
      if (isProjectBusy(workspace)) {
        return;
      }
      commitRailPrefs((prev) => markWorkspaceRemoved(prev, workspace));
      saveWorkspacePrefs(forgetActiveWorkspace(loadWorkspacePrefs(), workspace));
      const viewed = railRows.find((rec) => rec.id === selectedId);
      if (!viewed || !isRowInProject(viewed, workspace)) {
        return;
      }
      const nextId = nextChatAfterRemoval(
        dropHiddenProjectRows(railRows, removed.hidden),
        workspace,
      );
      if (nextId) {
        selectSession(nextId);
      } else {
        void newSession("");
      }
    },
    [
      commitRailPrefs,
      isProjectBusy,
      newSession,
      railRows,
      removed.hidden,
      selectSession,
      selectedId,
    ],
  );

  return { visibleCatalog, catalogLength, onRemoveProject, isProjectBusy };
}
