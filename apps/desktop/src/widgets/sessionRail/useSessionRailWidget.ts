/**
 * Unified entry hook for the session rail.
 * Owns catalog/store selects, rail prefs, filter/order, and handlers.
 * Presentation lives in SessionRailView (pure list chrome).
 */

import { useCallback, useMemo, useState } from "react";
import {
  applyWorkspaceSessionOrder,
  expandWorkspacePreview,
  isPreviewExpanded,
  isSessionPinned,
  isWorkspaceCollapsed,
  loadSessionRailPrefs,
  moveSessionIdInOrder,
  orderGroupsBySessionPin,
  orderSessionsByPin,
  saveSessionRailPrefs,
  toggleCollapsedWorkspace,
  togglePinnedSession,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";
import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import {
  NO_PROJECT_KEY,
  groupSessionsByProject,
  splitNoProjectSessions,
  type SessionRecord,
} from "@/store/sessionCatalog";
import { useSessionStore } from "@/store/sessionStore";

export type SessionRailWidgetProps = {
  /**
   * When provided, delete uses secondary confirm (J-05) instead of immediate remove.
   * @param id Session id.
   * @param title Display title for the confirm dialog.
   */
  onRequestDelete?: (id: string, title: string) => void;
  /**
   * Narrow-viewport overlay open flag. Above `sm` the rail is always visible;
   * below `sm` it is off-canvas until open.
   */
  open?: boolean;
  /** Close overlay (backdrop / after select). Ignored when always-docked. */
  onClose?: () => void;
  /**
   * Footer "N running" count: sessions currently streaming (AI outputting).
   * Missing → derived from poolEntries (`live && status === "streaming"`).
   * Idle / waiting_permission / disconnected pool residents do not count.
   */
  liveCount?: number;
};

/**
 * Session rail orchestration: store + prefs + groups + handlers.
 * @param props Optional delete confirm hook + mobile overlay open state.
 * @returns Props bundle for {@link SessionRailView}.
 */
export function useSessionRailWidget(props: SessionRailWidgetProps = {}) {
  const catalog = useSessionStore((s) => s.catalog);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const liveStatus = useSessionStore((s) => s.session.status);
  const poolEntries = useSessionStore((s) => s.poolEntries);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const reconnect = useSessionStore((s) => s.reconnect);
  const runCli = useSessionStore((s) => s.runCli);
  const [query, setQuery] = useState("");
  /**
   * Pin + collapse + preview-expand prefs. Seeded from memory cache /
   * localStorage so remounts restore the last collapse state instead of
   * re-initializing every project as expanded.
   */
  const [railPrefs, setRailPrefs] = useState<SessionRailPrefs>(() =>
    loadSessionRailPrefs(),
  );
  const railOpen = props.open ?? false;

  /** sessionId → pool status so background chats still show activity. */
  const poolStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of poolEntries) {
      if (e.live) {
        map.set(e.sessionId, e.status);
      }
    }
    return map;
  }, [poolEntries]);

  /**
   * Workspace-folder groups: project-name first-char order stays fixed.
   * Inside each folder: pin → drag → last message recency (`updatedAt`
   * desc). Pin never reorders the folder list itself.
   * Subagents and empty (no-message / untitled) drafts are stripped by
   * {@link filterCatalogForSessionRail} so the list only shows real chats.
   */
  const { groups, noProjectSessions } = useMemo(() => {
    const filtered = filterCatalogForSessionRail(catalog, query);
    // Unfiled chats are their own rail section, never a pseudo folder.
    const { noProject, withProject } = splitNoProjectSessions(filtered);
    return {
      groups: orderGroupsBySessionPin(
        groupSessionsByProject(withProject),
        railPrefs.pinnedSessions,
        railPrefs.sessionOrderByWorkspace,
      ),
      noProjectSessions: orderSessionsByPin(
        noProject,
        railPrefs.pinnedSessions,
        railPrefs.sessionOrderByWorkspace[NO_PROJECT_KEY],
      ),
    };
  }, [
    catalog,
    query,
    railPrefs.pinnedSessions,
    railPrefs.sessionOrderByWorkspace,
  ]);

  /**
   * Rail-visible session count (no search). Footer "Sessions N" uses this so
   * empty drafts / subagents do not inflate the density cue.
   */
  const catalogLength = useMemo(
    () => filterCatalogForSessionRail(catalog).length,
    [catalog],
  );

  const selectedId = viewingSessionId ?? activeSessionId;
  /**
   * Workspace folder that holds the viewed chat — the rail marks that project
   * so the selection stays locatable once its row scrolls under the sticky
   * header or the group is collapsed. Null when search filters the selection
   * out (no group may claim the marker then).
   */
  const selectedWorkspace = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const owner = groups.find((g) =>
      g.sessions.some((s) => s.id === selectedId),
    );
    return owner?.workspace ?? null;
  }, [groups, selectedId]);
  /** Same marker for the unfiled section when it holds the viewed chat. */
  const noProjectActive = useMemo(
    () =>
      Boolean(selectedId) &&
      noProjectSessions.some((s) => s.id === selectedId),
    [noProjectSessions, selectedId],
  );
  const live = connectionMode === "live-bridge";
  /** Chats surviving the filter; shown next to the section label while searching. */
  const matchCount =
    groups.reduce((n, g) => n + g.sessions.length, 0) +
    noProjectSessions.length;
  const searching = query.trim().length > 0;
  /** Sessions with a live process that is actively streaming agent output. */
  const streamingCount = poolEntries.filter(
    (e) => e.live && e.status === "streaming",
  ).length;
  /** Footer running badge; prop wins so App shell can share one derivation. */
  const liveCount = props.liveCount ?? streamingCount;

  /**
   * Select a session and dismiss the mobile rail overlay when open.
   * @param id Catalog session id.
   */
  const pickSession = useCallback(
    (id: string) => {
      selectSession(id);
      props.onClose?.();
    },
    [props, selectSession],
  );

  /**
   * Persist prefs after a local mutation so pin/collapse survive refresh.
   * Uses functional setState so rapid toggles never clobber each other with
   * a stale railPrefs closure.
   * @param updater Pure transform from previous prefs to next.
   */
  const commitRailPrefs = useCallback(
    (updater: (prev: SessionRailPrefs) => SessionRailPrefs) => {
      setRailPrefs((prev) => {
        const next = updater(prev);
        saveSessionRailPrefs(next);
        return next;
      });
    },
    [],
  );

  /**
   * Toggle collapse for a workspace group header click.
   * Persists to localStorage (and memory cache) so the folder does not
   * re-expand on remount / reload.
   * @param workspace Absolute path key for the group.
   */
  const onToggleCollapse = useCallback(
    (workspace: string) => {
      commitRailPrefs((prev) => toggleCollapsedWorkspace(prev, workspace));
    },
    [commitRailPrefs],
  );

  /**
   * Reveal sessions past the preview cap for one project ("Show more").
   * Persisted so remount keeps the full list open until collapse.
   * @param workspace Absolute path key for the group.
   */
  const onExpandPreview = useCallback(
    (workspace: string) => {
      commitRailPrefs((prev) => expandWorkspacePreview(prev, workspace));
    },
    [commitRailPrefs],
  );

  /**
   * Toggle pin so one chat sticks above auto/drag-sorted peers in its
   * workspace. Does not reorder or pin the project folder.
   * @param sessionId Catalog session id.
   */
  const onTogglePin = useCallback(
    (sessionId: string) => {
      commitRailPrefs((prev) => togglePinnedSession(prev, sessionId));
    },
    [commitRailPrefs],
  );

  /**
   * Persist a within-project drag: reorder the full group id list and store
   * it as drag order (outranks recency auto-sort). Drop is same-workspace only.
   * @param workspace Project workspace path key.
   * @param orderedIds Current top-to-bottom ids for that group (already pin/drag applied).
   * @param fromId Dragged session id.
   * @param toId Drop-target session id.
   */
  const onReorderSession = useCallback(
    (
      workspace: string,
      orderedIds: string[],
      fromId: string,
      toId: string,
    ) => {
      const nextIds = moveSessionIdInOrder(orderedIds, fromId, toId);
      if (nextIds === orderedIds) {
        return;
      }
      commitRailPrefs((prev) =>
        applyWorkspaceSessionOrder(prev, workspace, nextIds),
      );
    },
    [commitRailPrefs],
  );

  /**
   * Build row model for one catalog session (pool status + pin + handlers).
   * @param rec Catalog record for this row.
   * @param workspace Project workspace key (for drag-order scope).
   * @param orderedIds Full group order used when applying a drop.
   */
  const rowForSession = useCallback(
    (rec: SessionRecord, workspace: string, orderedIds: string[]) => {
      const pooled = poolStatusById.get(rec.id);
      const rowStatus =
        pooled ??
        (rec.id === activeSessionId || rec.id === selectedId
          ? liveStatus
          : rec.status);
      const isProcessLive =
        Boolean(pooled) || (rec.id === activeSessionId && live);
      return {
        rec,
        selected: rec.id === selectedId,
        isLiveActive: isProcessLive,
        liveStatus: rowStatus,
        pinned: isSessionPinned(railPrefs, rec.id),
        onSelect: () => pickSession(rec.id),
        onTogglePin: () => onTogglePin(rec.id),
        onReorder: (fromId: string, toId: string) =>
          onReorderSession(workspace, orderedIds, fromId, toId),
        onRemove: () => {
          if (props.onRequestDelete) {
            props.onRequestDelete(rec.id, rec.title);
          } else {
            removeSession(rec.id);
          }
        },
      };
    },
    [
      activeSessionId,
      live,
      liveStatus,
      onReorderSession,
      onTogglePin,
      pickSession,
      poolStatusById,
      props,
      railPrefs,
      removeSession,
      selectedId,
    ],
  );

  const isGroupCollapsed = useCallback(
    (workspace: string) => isWorkspaceCollapsed(railPrefs, workspace),
    [railPrefs],
  );

  /**
   * Whether "Show more" is sticky for this workspace (full list past preview).
   * @param workspace Absolute path key for the group.
   */
  const isGroupPreviewExpanded = useCallback(
    (workspace: string) => isPreviewExpanded(railPrefs, workspace),
    [railPrefs],
  );

  return {
    railOpen,
    onClose: props.onClose,
    query,
    setQuery,
    groups,
    /** Unfiled chats for the standalone "No project" rail section. */
    noProjectSessions,
    /** Whether the viewed chat lives in that section. */
    noProjectActive,
    /** Shared prefs key for its collapse / preview / drag order. */
    noProjectKey: NO_PROJECT_KEY,
    matchCount,
    searching,
    streamingCount,
    live,
    liveCount,
    catalogLength,
    selectedWorkspace,
    newSession,
    runCli,
    reconnect,
    rowForSession,
    isGroupCollapsed,
    isGroupPreviewExpanded,
    onToggleCollapse,
    onExpandPreview,
  };
}

export type SessionRailWidgetModel = ReturnType<typeof useSessionRailWidget>;
