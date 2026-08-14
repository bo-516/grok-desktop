/**
 * Standalone rail section for chats that belong to no workspace folder.
 * Sibling of the PROJECTS tree, not a folder inside it: the head is a quiet
 * uppercase section label (chevron + count) and rows sit flat — no folder
 * glyph, no tree guide — because there is no path to stand for.
 *
 * Collapse and "Show more" / "Show less" are controlled from the parent and
 * share the rail prefs machinery under the `(no project)` key, so the section
 * behaves exactly like a project group without pretending to be one.
 */

import cs from "classnames";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { projectGroupListModel } from "@/lib/sessionRailPreview";
import type { SessionRecord } from "@/store/sessionCatalog";
import { SessionRailGroupMoreView } from "./SessionRailGroupMoreView";

export type SessionRailNoProjectGroupViewProps = {
  /** Unfiled chats, already pin / drag / recency ordered by the parent. */
  sessions: SessionRecord[];
  /** This section holds the selected chat (lifts the label like a folder). */
  active?: boolean;
  /** When true, rows are fully hidden (label-only). */
  collapsed: boolean;
  /** When true (and not collapsed), show every row past the preview cap. */
  previewExpanded: boolean;
  /** Toggle full collapse for the section (persisted by parent). */
  onToggleCollapse: () => void;
  /** Persist "Show more" (full list past preview). */
  onExpandPreview: () => void;
  /** Persist "Show less" — back to the preview cap. */
  onCollapsePreview: () => void;
  /** Render one session row (selection / live / pin wiring stays in parent). */
  renderSession: (rec: SessionRecord) => ReactNode;
};

/**
 * "No project" block: sticky section label + flat session list.
 * Renders nothing when there are no unfiled chats, so the rail gains a second
 * section only once one exists.
 * Expanded lists longer than the 8-row cap scroll inside the section;
 * "Show less" restores the preview.
 * @param props Sessions, active/collapse/preview flags, and the row renderer.
 * @returns Section for the side-nav scroll area, below the project tree.
 */
export function SessionRailNoProjectGroupView(
  props: SessionRailNoProjectGroupViewProps,
) {
  const {
    sessions,
    active,
    collapsed,
    previewExpanded,
    onToggleCollapse,
    onExpandPreview,
    onCollapsePreview,
    renderSession,
  } = props;
  /** Unfiled chat count for the section badge (includes hidden preview rows). */
  const total = sessions.length;
  if (total === 0) {
    return null;
  }
  /** Visible slice plus more/less / inner-scroll flags. */
  const list = projectGroupListModel(sessions, collapsed, previewExpanded);

  return (
    <div
      className={cs("loose-group", {
        "loose-group-active": active,
        "loose-group-collapsed": collapsed,
      })}
    >
      <div className="loose-group-header group">
        <button
          type="button"
          className="project-group-main"
          onClick={() => onToggleCollapse()}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? "Expand no project" : "Collapse no project"
          }
          title="Chats started without a project"
        >
          {/* Same chevron affordance as a folder: rotated −90° when closed. */}
          <ChevronDown
            className={cs("project-group-chevron", {
              "project-group-chevron-collapsed": collapsed,
            })}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="loose-group-name">No project</span>
        </button>
        <span className="project-group-count" aria-label={`${total} chats`}>
          {total}
        </span>
      </div>

      {collapsed ? null : (
        <div className="loose-group-sessions">
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
