/**
 * Workspace project group for the session rail: tree-style folder header
 * (animated chevron + flat folder glyph + name + count), indented sessions
 * with a vertical guide, optional "Show more", collapse on header click.
 * Folder name is sticky at the top of the rail scrollport (PROJECTS sits
 * outside the scroll area) while this group's sessions scroll — see
 * project-group-header in shortcuts.sidenav. Pin lives on individual session
 * rows, not on the folder header.
 *
 * Collapse and "Show more" are controlled from the parent (rail prefs) so
 * remounts do not re-expand projects the user already closed.
 */

import cs from "classnames";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectGroup, SessionRecord } from "@/store/sessionCatalog";

/**
 * How many sessions show under a project before "Show more" (preview cap).
 * Full list appears after expand or when the group is smaller.
 */
export const PROJECT_SESSION_PREVIEW = 5;

export type SessionRailProjectGroupViewProps = {
  /** Workspace-clustered sessions for one project folder. */
  group: ProjectGroup;
  /**
   * This folder holds the selected chat. Marks the branch (folder glyph +
   * name + tree guide) so the current project reads even when the selected
   * row is scrolled away or the group is collapsed.
   */
  active?: boolean;
  /** When true, session rows are fully hidden (folder-only). */
  collapsed: boolean;
  /**
   * When true (and not collapsed), show every session past the preview cap.
   * Owned by rail prefs — not local useState — so remount keeps the choice.
   */
  previewExpanded: boolean;
  /** Toggle full collapse for this workspace (persisted by parent). */
  onToggleCollapse: () => void;
  /** Persist "Show more" for this workspace (full list past preview). */
  onExpandPreview: () => void;
  /** Render one session row (keeps selection/live/pin wiring in the parent). */
  renderSession: (rec: SessionRecord) => ReactNode;
};

/**
 * One project block: sticky folder header + nested session list with tree guide.
 * Hierarchy is stronger than a flat pill list so project vs chat stays clear.
 * Folder glyph has no well: closed `Folder` / open `FolderOpen` crossfade in
 * place; chevron rotates. Two UI states with a short opacity+scale transition.
 * Sticky positioning is pure CSS on `project-group-header` (top-0 in scroll).
 * `active` (folder of the selected chat) lifts the name to full contrast and
 * tints glyph + tree guide — idle folders sit at secondary ink.
 * Collapse / preview-expand are fully controlled; missing handlers leave the
 * folder stuck open or the list stuck at the preview cap.
 * @param props Group data, active/collapse/preview flags, and session row renderer.
 * @returns Project section for the side-nav scroll area.
 */
export function SessionRailProjectGroupView(
  props: SessionRailProjectGroupViewProps,
) {
  const {
    group,
    active,
    collapsed,
    previewExpanded,
    onToggleCollapse,
    onExpandPreview,
    renderSession,
  } = props;
  const total = group.sessions.length;
  const previewing =
    !collapsed && !previewExpanded && total > PROJECT_SESSION_PREVIEW;
  let visible = group.sessions;
  let collapseLabel = `Collapse ${group.projectName}`;
  if (collapsed) {
    visible = [];
    collapseLabel = `Expand ${group.projectName}`;
  } else if (previewing) {
    visible = group.sessions.slice(0, PROJECT_SESSION_PREVIEW);
  }

  return (
    <div
      className={cs("project-group", {
        "project-group-active": active,
        "project-group-collapsed": collapsed,
      })}
    >
      <div className="project-group-header group">
        <button
          type="button"
          className="project-group-main"
          onClick={() => onToggleCollapse()}
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          title={group.workspace || group.projectName}
        >
          {/* One chevron rotated −90° when collapsed (points right). */}
          <ChevronDown
            className={cs("project-group-chevron", {
              "project-group-chevron-collapsed": collapsed,
            })}
            strokeWidth={2}
            aria-hidden="true"
          />
          {/* Both glyphs stacked; active one fades/scales in (no well). */}
          <span className="project-group-folder" aria-hidden="true">
            <Folder
              className={cs("project-group-icon", {
                "project-group-icon-active": collapsed,
                "project-group-icon-idle": !collapsed,
              })}
              strokeWidth={1.75}
            />
            <FolderOpen
              className={cs("project-group-icon", {
                "project-group-icon-active": !collapsed,
                "project-group-icon-idle": collapsed,
              })}
              strokeWidth={1.75}
            />
          </span>
          <span className="project-group-name">{group.projectName}</span>
        </button>
        <span
          className="project-group-count"
          aria-label={`${total} chats`}
        >
          {total}
        </span>
      </div>

      {collapsed ? null : (
        <div className="project-group-sessions">
          {visible.map((rec) => renderSession(rec))}
          {previewing ? (
            <button
              type="button"
              className="project-group-more"
              onClick={() => onExpandPreview()}
            >
              Show {total - PROJECT_SESSION_PREVIEW} more
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
