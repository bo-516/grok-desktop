/**
 * Codex-style workspace project group for the session rail:
 * folder + name header, indented sessions, optional "Show more",
 * collapse on header click, pin on hover.
 */

import cs from "classnames";
import { Folder, Pin } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ProjectGroup, SessionRecord } from "@/store/sessionCatalog";

/**
 * How many sessions show under a project before "Show more" (Codex-style
 * preview). Full list appears after expand or when the group is smaller.
 */
export const PROJECT_SESSION_PREVIEW = 5;

export type SessionRailProjectGroupViewProps = {
  /** Workspace-clustered sessions for one project folder. */
  group: ProjectGroup;
  /** Whether this workspace is pinned to the top of the rail. */
  pinned: boolean;
  /** When true, session rows are fully hidden (folder-only). */
  collapsed: boolean;
  /** Toggle full collapse for this workspace. */
  onToggleCollapse: () => void;
  /** Toggle pin for this workspace. */
  onTogglePin: () => void;
  /** Render one session row (keeps selection/live wiring in the parent). */
  renderSession: (rec: SessionRecord) => ReactNode;
};

/**
 * One project block: minimal folder header + indented session list.
 * Matches Codex mission-control hierarchy (not a heavy card header).
 * @param props Group data, pin/collapse flags, and session row renderer.
 * @returns Project section for the side-nav scroll area.
 */
export function SessionRailProjectGroupView(
  props: SessionRailProjectGroupViewProps,
) {
  const {
    group,
    pinned,
    collapsed,
    onToggleCollapse,
    onTogglePin,
    renderSession,
  } = props;
  /** Local "show full list" for this mount; resets when group collapses. */
  const [showAll, setShowAll] = useState(false);
  const total = group.sessions.length;
  const previewing =
    !collapsed && !showAll && total > PROJECT_SESSION_PREVIEW;
  const visible = collapsed
    ? []
    : previewing
      ? group.sessions.slice(0, PROJECT_SESSION_PREVIEW)
      : group.sessions;
  const collapseLabel = collapsed
    ? `Expand ${group.projectName}`
    : `Collapse ${group.projectName}`;
  const pinLabel = pinned
    ? `Unpin ${group.projectName}`
    : `Pin ${group.projectName} to top`;

  return (
    <div
      className={cs("project-group", {
        "project-group-collapsed": collapsed,
      })}
      data-pinned={pinned ? "true" : "false"}
    >
      <div className="project-group-header group">
        <button
          type="button"
          className="project-group-main"
          onClick={() => {
            if (collapsed) {
              setShowAll(false);
            }
            onToggleCollapse();
          }}
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          title={group.workspace || group.projectName}
        >
          <Folder
            className="project-group-icon"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <span className="project-group-name">{group.projectName}</span>
          {pinned ? (
            <Pin
              className="project-group-pin-mark"
              strokeWidth={2}
              fill="currentColor"
              aria-hidden="true"
            />
          ) : null}
        </button>
        <button
          type="button"
          className={cs("project-group-pin", {
            "project-group-pin-active": pinned,
          })}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          aria-pressed={pinned}
          aria-label={pinLabel}
          title={pinLabel}
        >
          <Pin
            className="project-group-icon"
            strokeWidth={1.75}
            fill={pinned ? "currentColor" : "none"}
          />
        </button>
      </div>

      {collapsed ? null : (
        <div className="project-group-sessions">
          {visible.map((rec) => renderSession(rec))}
          {previewing ? (
            <button
              type="button"
              className="project-group-more"
              onClick={() => setShowAll(true)}
            >
              Show more
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
