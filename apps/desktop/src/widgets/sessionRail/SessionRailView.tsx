/**
 * Pure session list chrome: brand, New chat + search, fixed PROJECTS label,
 * scrollable workspace groups (sticky folder names), footer.
 * No store/prefs orchestration — those live in useSessionRailWidget.
 */

import { GlareHover } from "@/components/react-bits";
import type { SessionRecord } from "@/store/sessionCatalog";
import { SessionRailFooterView } from "../SessionRailFooterView";
import { SessionRailNoProjectGroupView } from "../SessionRailNoProjectGroupView";
import { SessionRailProjectGroupView } from "../SessionRailProjectGroupView";
import { SessionRailSessionRowView } from "../SessionRailSessionRowView";
import type { SessionRailWidgetModel } from "./useSessionRailWidget";

export type SessionRailViewProps = SessionRailWidgetModel;

/**
 * Session list rail presentation.
 * @param props Model from useSessionRailWidget; missing handlers break row actions.
 * @returns Fixed left navigation chrome (no store subscriptions).
 */
export function SessionRailView(props: SessionRailViewProps) {
  const {
    railOpen,
    onClose,
    query,
    setQuery,
    groups,
    noProjectSessions,
    noProjectActive,
    noProjectKey,
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
  } = props;

  /**
   * One session row with its full model (selection, live status, pin, drag).
   * Shared by the project tree and the no-project section so both lists behave
   * identically; `workspace` scopes drag order to the owning section.
   * @param rec Catalog row to render.
   * @param workspace Section key (project path or the no-project key).
   * @param orderedIds Visible top-to-bottom ids of that section, for drops.
   */
  const renderRow = (
    rec: SessionRecord,
    workspace: string,
    orderedIds: string[],
  ) => {
    const row = rowForSession(rec, workspace, orderedIds);
    return (
      <SessionRailSessionRowView
        key={rec.id}
        rec={row.rec}
        selected={row.selected}
        isLiveActive={row.isLiveActive}
        liveStatus={row.liveStatus}
        pinned={row.pinned}
        onSelect={row.onSelect}
        onTogglePin={row.onTogglePin}
        onReorder={row.onReorder}
        onRemove={row.onRemove}
      />
    );
  };

  return (
    <>
      {railOpen ? (
        <button
          type="button"
          className="side-nav-backdrop"
          data-open="true"
          aria-label="Close sessions"
          onClick={() => onClose?.()}
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
                window.dispatchEvent(
                  new CustomEvent("grok-desktop:open-palette"),
                )
              }
            >
              ⌘K
            </button>
          </label>
        </div>

        {/*
         * PROJECTS sits outside the scrollport so list rows cannot peek under
         * the label (sticky-in-scroll left a subpixel bleed above the head).
         * Workspace folder names stick at top-0 inside the scroll area.
         */}
        {groups.length > 0 ? (
          <div className="project-section-head">
            <span className="project-section-label">Projects</span>
            {searching ? (
              <span className="project-section-count">
                {matchCount} found
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="side-nav-scroll">
          {groups.length === 0 && noProjectSessions.length === 0 ? (
            <div className="side-nav-empty">
              {query
                ? "No matching chats"
                : "No chats yet. Send a message to start."}
            </div>
          ) : (
            <>
              {groups.map((group) => (
                <SessionRailProjectGroupView
                  key={group.workspace}
                  group={group}
                  active={group.workspace === selectedWorkspace}
                  collapsed={isGroupCollapsed(group.workspace)}
                  previewExpanded={isGroupPreviewExpanded(group.workspace)}
                  onToggleCollapse={() => onToggleCollapse(group.workspace)}
                  onExpandPreview={() => onExpandPreview(group.workspace)}
                  renderSession={(rec: SessionRecord) =>
                    renderRow(
                      rec,
                      group.workspace,
                      group.sessions.map((s) => s.id),
                    )
                  }
                />
              ))}
              {/*
               * Chats with no workspace folder. Own section below the tree
               * (renders nothing while empty) so they stop hiding inside the
               * project their bridge process happened to run from.
               */}
              <SessionRailNoProjectGroupView
                sessions={noProjectSessions}
                active={noProjectActive}
                collapsed={isGroupCollapsed(noProjectKey)}
                previewExpanded={isGroupPreviewExpanded(noProjectKey)}
                onToggleCollapse={() => onToggleCollapse(noProjectKey)}
                onExpandPreview={() => onExpandPreview(noProjectKey)}
                renderSession={(rec: SessionRecord) =>
                  renderRow(
                    rec,
                    noProjectKey,
                    noProjectSessions.map((s) => s.id),
                  )
                }
              />
            </>
          )}
        </div>

        <SessionRailFooterView
          catalogLength={catalogLength}
          streamingCount={streamingCount}
          live={live}
          liveCount={liveCount}
          onReconnect={() => void reconnect().catch(() => undefined)}
        />
      </aside>
    </>
  );
}
