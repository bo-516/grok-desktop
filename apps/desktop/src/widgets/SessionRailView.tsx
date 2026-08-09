/**
 * Left side-nav (Framer prototype): brand, New chat + search with kbd,
 * sessions grouped by Today / Yesterday / Earlier, soft footer status.
 */

import cs from "classnames";
import { useMemo, useState, type CSSProperties } from "react";
import { GlareHover, ShinyText } from "@/components/react-bits";
import {
  formatRelativeTime,
  groupSessionsByTime,
  type SessionRecord,
} from "../store/sessionCatalog";
import { useSessionStore } from "../store/sessionStore";

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
   * Live process count for footer status (replaces duplicate sync chip).
   * Missing → falls back to poolEntries length from the store.
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
    return groupSessionsByTime(filtered);
  }, [catalog, query]);

  const selectedId = viewingSessionId ?? activeSessionId;
  const live = connectionMode === "live-bridge";
  const liveCount =
    props.liveCount ?? poolEntries.filter((e) => e.live).length;
  const streamingCount = poolEntries.filter(
    (e) => e.live && e.status === "streaming",
  ).length;

  /**
   * Select a session and dismiss the mobile rail overlay when open.
   * @param id Catalog session id.
   */
  const pickSession = (id: string) => {
    selectSession(id);
    props.onClose?.();
  };

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
          groups.map((group) => (
            <div key={group.bucket} className="time-group">
              <div className="time-group-label">{group.label}</div>
              {group.sessions.map((rec) => {
                const pooled = poolStatusById.get(rec.id);
                const rowStatus =
                  pooled ??
                  (rec.id === activeSessionId || rec.id === selectedId
                    ? liveStatus
                    : rec.status);
                const isProcessLive =
                  Boolean(pooled) || (rec.id === activeSessionId && live);
                return (
                  <SessionRow
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
              })}
            </div>
          ))
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
              <FooterLiveStatus live={live} liveCount={liveCount} />
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

/**
 * Footer process status: offline / N running (with shine when live processes exist).
 * @param props live flag and process count.
 */
function FooterLiveStatus(props: { live: boolean; liveCount: number }) {
  if (!props.live) {
    return <>Offline</>;
  }
  if (props.liveCount > 0) {
    return (
      <ShinyText text={`${props.liveCount} running`} speed="slow" />
    );
  }
  return <>0 running</>;
}

/**
 * One session row: title (ellipsis) + meta slot (relative time / remove).
 * Grid columns keep title and meta paint-separated so long titles never
 * overlap `now` / `2h` / `yesterday` on narrow sidebar width.
 * @param props Session record, selection / live flags, select + remove handlers.
 * @returns Interactive row for the side-nav session list.
 */
function SessionRow(props: {
  rec: SessionRecord;
  selected: boolean;
  isLiveActive: boolean;
  liveStatus: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { rec, selected, isLiveActive, liveStatus, onSelect, onRemove } = props;
  const timeLabel =
    liveStatus === "streaming" && isLiveActive
      ? "…"
      : formatRelativeTime(rec.updatedAt);

  return (
    <div
      className={cs("sess-row group", {
        "sess-row-active": selected,
        "sess-row-process-live": isLiveActive && liveStatus === "streaming",
      })}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="sess-title" title={rec.title}>
        {rec.title}
      </span>
      <span className="sess-meta">
        <span className="sess-time" title={formatRelativeTime(rec.updatedAt)}>
          {timeLabel}
        </span>
        <button
          type="button"
          className="sess-remove"
          title="Remove from list"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </span>
    </div>
  );
}
