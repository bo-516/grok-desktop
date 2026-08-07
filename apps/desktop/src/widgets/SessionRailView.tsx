/**
 * Left side-nav (Framer prototype): brand, New Chat, search, Recent by project.
 */

import cs from "classnames";
import { useMemo, useState } from "react";
import {
  formatRelativeTime,
  groupSessionsByProject,
  type SessionRecord,
} from "../store/sessionCatalog";
import { useSessionStore } from "../store/sessionStore";

export function SessionRailView() {
  const catalog = useSessionStore((s) => s.catalog);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const liveStatus = useSessionStore((s) => s.session.status);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const reconnect = useSessionStore((s) => s.reconnect);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const all = groupSessionsByProject(catalog);
    const q = query.trim().toLowerCase();
    if (!q) {return all;}
    return all
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.workspace.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [catalog, query]);

  const selectedId = viewingSessionId ?? activeSessionId;
  const live = connectionMode === "live-bridge";

  return (
    <aside className="side-nav" aria-label="Sessions">
      <div className="side-nav-header">
        <div className="side-nav-logo" aria-hidden="true">
          G
        </div>
        <div className="side-nav-brand">
          <p className="side-nav-title">Grok</p>
          <p className="side-nav-subtitle">desktop · live</p>
        </div>
      </div>

      <div className="side-nav-cta">
        <button
          type="button"
          className="btn-new-chat"
          onClick={() => void newSession()}
        >
          <span aria-hidden="true">+</span>
          New chat
        </button>
      </div>

      <div className="side-nav-cta">
        <input
          className="side-nav-search"
          type="search"
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search chats"
        />
      </div>

      <div className="side-nav-section-label">
        <span>Recent</span>
        <span className="side-nav-section-count">{catalog.length}</span>
      </div>

      <div className="side-nav-scroll">
        {groups.length === 0 ? (
          <div className="side-nav-empty">
            {query
              ? "No matching sessions"
              : "No sessions yet. After you send a message, they appear here by project."}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.workspace} className="project-group">
              <div className="project-group-label" title={group.workspace}>
                <span className="project-group-name">{group.projectName}</span>
                <span className="project-group-path">
                  {shortPath(group.workspace)}
                </span>
              </div>
              {group.sessions.map((rec) => (
                <SessionRow
                  key={rec.id}
                  rec={rec}
                  selected={rec.id === selectedId}
                  isLiveActive={
                    rec.id === activeSessionId && live
                  }
                  liveStatus={
                    rec.id === activeSessionId ? liveStatus : rec.status
                  }
                  onSelect={() => selectSession(rec.id)}
                  onRemove={() => removeSession(rec.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="side-nav-footer">
        <button
          type="button"
          className="side-nav-footer-item"
          onClick={() => void reconnect().catch(() => undefined)}
          title="Restore the current/latest session; does not create a new chat"
        >
          <span aria-hidden="true">↻</span>
          {live ? "Reconnect" : "Connect and restore"}
        </button>
        <div className="side-nav-footer-item side-nav-footer-status">
          <span aria-hidden="true">●</span>
          {live ? "Connected" : "Disconnected"}
        </div>
      </div>
    </aside>
  );
}

function SessionRow(props: {
  rec: SessionRecord;
  selected: boolean;
  isLiveActive: boolean;
  liveStatus: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { rec, selected, isLiveActive, liveStatus, onSelect, onRemove } = props;
  const pipClass = cs("pip", {
    "pip-streaming": liveStatus === "streaming",
    "pip-waiting": liveStatus === "waiting_permission",
    "pip-disconnected": liveStatus === "disconnected" && isLiveActive,
    "pip-idle": liveStatus === "idle" || !isLiveActive,
  });

  return (
    <div
      className={cs("sess-row", { "sess-row-active": selected })}
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
      <div className="sess-meta">
        <span className={pipClass} title={liveStatus} />
        <span className="sess-title" title={rec.title}>
          {rec.title}
        </span>
      </div>
      <span
        className="sess-time"
        title={formatRelativeTime(rec.updatedAt)}
      >
        {formatRelativeTime(rec.updatedAt)}
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
    </div>
  );
}

function shortPath(workspace: string): string {
  if (workspace.length <= 28) {return workspace;}
  return `…${workspace.slice(-26)}`;
}
