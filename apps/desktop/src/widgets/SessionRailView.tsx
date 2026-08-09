/**
 * Left side-nav (Framer prototype): brand, New chat + search with kbd,
 * sessions grouped by workspace folder (project), soft footer status.
 * Recency within / across groups uses last user or agent message time
 * (`SessionRecord.updatedAt`), not selection/focus order. Workspace groups
 * support collapse + pin (persisted in session rail prefs).
 */

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { GlareHover } from "@/components/react-bits";
import {
  isWorkspaceCollapsed,
  isWorkspacePinned,
  loadSessionRailPrefs,
  orderGroupsByPin,
  saveSessionRailPrefs,
  toggleCollapsedWorkspace,
  togglePinnedWorkspace,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";
import { groupSessionsByProject } from "../store/sessionCatalog";
import { useSessionStore } from "../store/sessionStore";
import { SessionRailProjectGroupView } from "./SessionRailProjectGroupView";
import {
  SessionRailFooterLiveStatus,
  SessionRailSessionRowView,
} from "./SessionRailSessionRowView";

type SessionRailViewProps = {
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
 * Session list rail for switching and creating chats.
 * @param props Optional delete confirm hook + mobile overlay open state.
 * @returns Fixed left navigation bound to the live session catalog.
 */
export function SessionRailView(props: SessionRailViewProps = {}) {
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
   * Workspace-folder groups sorted by last message, then reordered so pinned
   * projects stay on top (user pin order).
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
    const byRecency = groupSessionsByProject(filtered);
    return orderGroupsByPin(byRecency, railPrefs.pinnedWorkspaces);
  }, [catalog, query, railPrefs.pinnedWorkspaces]);

  const selectedId = viewingSessionId ?? activeSessionId;
  const live = connectionMode === "live-bridge";
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
  const pickSession = (id: string) => {
    selectSession(id);
    props.onClose?.();
  };

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
   * Toggle pin so a workspace sticks above recency-sorted groups.
   * @param workspace Absolute path key for the group.
   */
  const onTogglePin = useCallback(
    (workspace: string) => {
      commitRailPrefs(togglePinnedWorkspace(railPrefs, workspace));
    },
    [commitRailPrefs, railPrefs],
  );

  return (
    <>
      {railOpen ? (
        <button
          type="button"
          className="side-nav-backdrop"
          data-open="true"
          aria-label="Close sessions"
          onClick={() => props.onClose?.()}
        />
      ) : null}
      <aside
        id="session-rail"
        className="side-nav"
        aria-label="Sessions"
        data-open={railOpen ? "true" : "false"}
      >
      <div className="side-nav-header">
        <p className="side-nav-title">Grok</p>
      </div>

      <div className="side-nav-actions">
        <GlareHover>
          <button
            type="button"
            className="btn-new-chat"
            onClick={() => void newSession()}
          >
            <span className="btn-new-chat-label">
              <span className="btn-new-chat-icon" aria-hidden="true">
                +
              </span>
              New chat
            </span>
            <kbd className="side-nav-kbd">⌘N</kbd>
          </button>
        </GlareHover>

        <label className="side-nav-search-wrap">
          <span className="side-nav-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="side-nav-search"
            type="search"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter triggers upstream sessions search (F-SESS-08) when live.
              if (e.key === "Enter" && query.trim()) {
                void runCli("sessions_search", { query: query.trim() });
              }
            }}
            aria-label="Search chats"
          />
          <button
            type="button"
            className="side-nav-kbd side-nav-kbd-btn"
            title="Open command palette"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("grok-desktop:open-palette"))
            }
          >
            ⌘K
          </button>
        </label>
      </div>

      <div className="side-nav-scroll">
        {groups.length === 0 ? (
          <div className="side-nav-empty">
            {query
              ? "No matching chats"
              : "No chats yet. Send a message to start."}
          </div>
        ) : (
          <>
            <div className="project-section-label">Projects</div>
            {groups.map((group) => (
              <SessionRailProjectGroupView
                key={group.workspace}
                group={group}
                pinned={isWorkspacePinned(railPrefs, group.workspace)}
                collapsed={isWorkspaceCollapsed(railPrefs, group.workspace)}
                onToggleCollapse={() => onToggleCollapse(group.workspace)}
                onTogglePin={() => onTogglePin(group.workspace)}
                renderSession={(rec) => {
                  const pooled = poolStatusById.get(rec.id);
                  const rowStatus =
                    pooled ??
                    (rec.id === activeSessionId || rec.id === selectedId
                      ? liveStatus
                      : rec.status);
                  const isProcessLive =
                    Boolean(pooled) || (rec.id === activeSessionId && live);
                  return (
                    <SessionRailSessionRowView
                      key={rec.id}
                      rec={rec}
                      selected={rec.id === selectedId}
                      isLiveActive={isProcessLive}
                      liveStatus={rowStatus}
                      onSelect={() => pickSession(rec.id)}
                      onRemove={() => {
                        if (props.onRequestDelete) {
                          props.onRequestDelete(rec.id, rec.title);
                        } else {
                          removeSession(rec.id);
                        }
                      }}
                    />
                  );
                }}
              />
            ))}
          </>
        )}
      </div>

      <div className="side-nav-footer">
        <nav className="side-nav-nav" aria-label="Workspace">
          <button
            type="button"
            className="side-nav-footer-btn"
            title="Session settings (⌘,)"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("grok-desktop:open-panel", {
                  detail: "settings",
                }),
              )
            }
          >
            Settings
          </button>
          <button
            type="button"
            className="side-nav-footer-btn"
            title="Background tasks"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("grok-desktop:open-panel", {
                  detail: "tasks",
                }),
              )
            }
          >
            Tasks
            {streamingCount > 0 ? (
              <span className="side-nav-nav-badge" aria-hidden="true">
                {streamingCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="side-nav-footer-btn"
            title="Multi-session overview"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("grok-desktop:open-panel", {
                  detail: "overview",
                }),
              )
            }
          >
            Overview
          </button>
          <button
            type="button"
            className="side-nav-footer-btn"
            title="Extensions / MCP inspect"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("grok-desktop:open-panel", {
                  detail: "extensions",
                }),
              )
            }
          >
            Extensions
          </button>
        </nav>

        <div className="side-nav-quota" title="Local session count">
          <span className="side-nav-quota-label">Sessions</span>
          <span className="side-nav-quota-value">{catalog.length}</span>
          <div className="side-nav-quota-track" aria-hidden="true">
            <div
              className="side-nav-quota-fill"
              style={
                {
                  /* width only — catalog density cue, not a color token */
                  width: `${Math.min(100, Math.max(8, catalog.length * 8))}%`,
                } satisfies CSSProperties
              }
            />
          </div>
        </div>

        <button
          type="button"
          className="side-nav-user group"
          onClick={() => void reconnect().catch(() => undefined)}
          title={
            live
              ? "Reconnect live grok-build"
              : "Connect and restore the latest session"
          }
        >
          <span className="side-nav-avatar" aria-hidden="true">
            G
          </span>
          <span className="side-nav-user-meta">
            <span className="side-nav-user-name">grok-build</span>
            <span className="side-nav-user-status">
              <SessionRailFooterLiveStatus live={live} liveCount={liveCount} />
            </span>
          </span>
          <span className="side-nav-user-action" aria-hidden="true">
            ↻
          </span>
        </button>
      </div>
    </aside>
    </>
  );
}
