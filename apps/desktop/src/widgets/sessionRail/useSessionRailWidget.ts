/**
 * Unified entry hook for the session rail.
 * Owns catalog/store selects, rail prefs, filter/order, and handlers.
 * Presentation lives in SessionRailView (pure list chrome).
 */

import { useCallback, useMemo, useState } from "react";
import {
  applyWorkspaceSessionOrder,
  isSessionPinned,
  isWorkspaceCollapsed,
  loadSessionRailPrefs,
  moveSessionIdInOrder,
  orderGroupsBySessionPin,
  saveSessionRailPrefs,
  toggleCollapsedWorkspace,
  togglePinnedSession,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";
import {
  groupSessionsByProject,
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
  /** Pin + collapse prefs; seeded from localStorage once per mount. */
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
   * Workspace-folder groups: project-name first-char auto-sort stays fixed.
   * Inside each folder, pin + per-workspace drag order apply (drag beats
   * auto; pin beats both). Pin never reorders the folder list itself.
   */
  const groups = useMemo(() => {
    const filtered = (() => {
      const q = query.trim().toLowerCase();
      if (!q) {
        return catalog;
      }
      return catalog.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.workspace.toLowerCase().includes(q),
      );
    })();
    const byAscii = groupSessionsByProject(filtered);
    return orderGroupsBySessionPin(
      byAscii,
      railPrefs.pinnedSessions,
      railPrefs.sessionOrderByWorkspace,
    );
  }, [
    catalog,
    query,
    railPrefs.pinnedSessions,
    railPrefs.sessionOrderByWorkspace,
  ]);

  const selectedId = viewingSessionId ?? activeSessionId;
  const live = connectionMode === "live-bridge";
  /** Chats surviving the filter; shown next to the section label while searching. */
  const matchCount = groups.reduce((n, g) => n + g.sessions.length, 0);
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
   * @param next Full next prefs blob.
   */
  const commitRailPrefs = useCallback((next: SessionRailPrefs) => {
    setRailPrefs(next);
    saveSessionRailPrefs(next);
  }, []);

  /**
   * Toggle collapse for a workspace group header click.
   * @param workspace Absolute path key for the group.
   */
  const onToggleCollapse = useCallback(
    (workspace: string) => {
      commitRailPrefs(toggleCollapsedWorkspace(railPrefs, workspace));
    },
    [commitRailPrefs, railPrefs],
  );

  /**
   * Toggle pin so one chat sticks above auto/drag-sorted peers in its
   * workspace. Does not reorder or pin the project folder.
   * @param sessionId Catalog session id.
   */
  const onTogglePin = useCallback(
    (sessionId: string) => {
      commitRailPrefs(togglePinnedSession(railPrefs, sessionId));
    },
    [commitRailPrefs, railPrefs],
  );

  /**
   * Persist a within-project drag: reorder the full group id list and store
   * it as drag order (outranks title auto-sort). Drop is same-workspace only.
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
      commitRailPrefs(
        applyWorkspaceSessionOrder(railPrefs, workspace, nextIds),
      );
    },
    [commitRailPrefs, railPrefs],
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

  return {
    railOpen,
    onClose: props.onClose,
    query,
    setQuery,
    groups,
    matchCount,
    searching,
    streamingCount,
    live,
    liveCount,
    catalogLength: catalog.length,
    newSession,
    runCli,
    reconnect,
    rowForSession,
    isGroupCollapsed,
    onToggleCollapse,
  };
}

export type SessionRailWidgetModel = ReturnType<typeof useSessionRailWidget>;
