/**
 * Workspace project group for the session rail: tree-style folder header
 * (animated chevron + flat folder glyph + name + count), indented sessions
 * with a vertical guide, optional "Show more" / "Show less", collapse
 * on header click. Expanded lists cap the viewport at 8 rows and scroll.
 * Folder name is sticky at the top of the rail scrollport (PROJECTS sits
 * outside the scroll area) while this group's sessions scroll — see
 * project-group-header in shortcuts.sidenav. Pin lives on individual session
 * rows, not on the folder header.
 *
 * Collapse and "Show more" / "Show less" are controlled from the parent
 * (rail prefs) so remounts do not re-expand projects the user already closed.
 */

import cs from "classnames";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { projectGroupListModel } from "@/lib/sessionRailPreview";
import type { ProjectGroup, SessionRecord } from "@/store/sessionCatalog";
import { SessionRailGroupMoreView } from "./SessionRailGroupMoreView";

export {
  PROJECT_SESSION_EXPANDED_CAP,
  PROJECT_SESSION_PREVIEW,
} from "@/lib/sessionRailPreview";

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
   * Owned by rail prefs — not local component state — so remount keeps the choice.
   */
  previewExpanded: boolean;
  /** Toggle full collapse for this workspace (persisted by parent). */
  onToggleCollapse: () => void;
  /** Persist "Show more" for this workspace (full list past preview). */
  onExpandPreview: () => void;
  /** Persist "Show less" — back to the preview cap. */
  onCollapsePreview: () => void;
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
 * folder stuck open or the list stuck at the preview cap. Expanded lists
 * longer than the 8-row cap scroll inside the group; "Show less" restores
 * the preview.
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
    onCollapsePreview,
    renderSession,
  } = props;
  /** Folder chat count for the header badge (includes hidden preview rows). */
  const total = group.sessions.length;
  /** Visible slice plus more/less / inner-scroll flags. */
  const list = projectGroupListModel(
    group.sessions,
    collapsed,
    previewExpanded,
  );
  /** Header control verb flips with collapse so the a11y name stays accurate. */
  const collapseLabel = collapsed
    ? `Expand ${group.projectName}`
    : `Collapse ${group.projectName}`;

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
          <div
            className={cs("project-group-session-list", {
              "project-group-session-list-scroll": list.overflow,
            })}
          >
            {list.visible.map((rec) => renderSession(rec))}
          </div>
          <SessionRailGroupMoreView
            remaining={list.remaining}
            showMore={list.showMore}
            showLess={list.showLess}
            onShowMore={onExpandPreview}
            onShowLess={onCollapsePreview}
          />
        </div>
      )}
    </div>
  );
}
