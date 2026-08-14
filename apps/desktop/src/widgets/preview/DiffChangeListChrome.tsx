/**
 * Sticky change-list summary strip: file-count label plus wrap / dual-gutter /
 * show-full-file / collapse-all. Labels and icons are both in the DOM; a
 * container query on the actions cluster shows text when leftover width can
 * hold the labeled row, otherwise icons. The cluster's min-width is the
 * four-icon row, so the group wraps only after icons still do not fit.
 */

import cs from "classnames";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FoldVertical,
  UnfoldVertical,
  WrapText,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import type { DiffViewPrefs } from "@/lib/diffViewPrefs";

/** Lucide mark size for compact summary actions (fits the 24px face). */
const ACTION_ICON_PX = 14;
/** Stroke matching the file-head chevron so the strip does not jump. */
const ACTION_ICON_STROKE = 1.75;

export type DiffChangeListChromeProps = {
  /** File count label text already computed by parent. */
  summary: ReactNode;
  /**
   * Host measures this node (ResizeObserver) and writes --preview-summary-h
   * so sticky file heads sit under the real strip, not a guessed 2rem.
   */
  chromeRef?: Ref<HTMLDivElement>;
  /** True when every file section is collapsed. */
  allCollapsed: boolean;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  /** Shared layout prefs for every file section under this list. */
  viewPrefs?: DiffViewPrefs;
  /**
   * Patch shared prefs (parent persists). When omitted, pref buttons hide.
   * Prefer-full-file is a toggle: on expands every gap; off collapses back to
   * the original change-only fragments (gap bands again).
   * @param patch Partial prefs to merge.
   */
  onViewPrefsChange?: (patch: Partial<DiffViewPrefs>) => void;
};

type ChangeListActionProps = {
  /** Visible text when the cluster is wide enough; also the accessible name. */
  label: string;
  /**
   * Hover / long-press hint. Prefer a verb phrase (what the click does now).
   * Falls back to `label` when omitted.
   */
  title?: string;
  /**
   * Toggle pressed state. When true, the label prefixes "✓ " and the face
   * uses the on chrome. Omit for one-shot actions (collapse / expand).
   */
  pressed?: boolean;
  /** Compact-mode glyph (lucide). */
  icon: LucideIcon;
  /** Click handler for this control. */
  onClick: () => void;
};

/**
 * One summary control: icon and label share the button; CSS picks which
 * face is visible from leftover width (see preview-change-summary-action-*).
 * @param props Label, optional title / pressed, icon component, click handler.
 */
function ChangeListAction(props: ChangeListActionProps) {
  const { label, title, pressed, icon: Icon, onClick } = props;
  return (
    <button
      type="button"
      className={cs("preview-change-summary-action", {
        "preview-change-summary-action-on": pressed === true,
      })}
      aria-pressed={pressed}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      <span className="preview-change-summary-action-icon" aria-hidden="true">
        <Icon size={ACTION_ICON_PX} strokeWidth={ACTION_ICON_STROKE} />
      </span>
      <span className="preview-change-summary-action-label">
        {pressed === true ? "✓ " : ""}
        {label}
      </span>
    </button>
  );
}

/**
 * Sticky summary row with bulk collapse + shared diff display prefs.
 * Compact-then-wrap lives in CSS (container query + icon-row min-width).
 * @param props Summary contents + optional measure ref + bulk expand + prefs.
 */
export function DiffChangeListChrome(props: DiffChangeListChromeProps) {
  const {
    summary,
    chromeRef,
    allCollapsed,
    onCollapseAll,
    onExpandAll,
    viewPrefs,
    onViewPrefsChange,
  } = props;
  /** Bulk control label flips with the all-collapsed flag. */
  const collapseLabel = allCollapsed ? "Expand all" : "Collapse all";
  /** Unfold when every file is collapsed; fold when any file is open. */
  const collapseIcon = allCollapsed ? ChevronsUpDown : ChevronsDownUp;
  /** Shared collapse/expand control (prefs row or the prefs-less fallback). */
  const collapseAction = (
    <ChangeListAction
      label={collapseLabel}
      icon={collapseIcon}
      onClick={allCollapsed ? onExpandAll : onCollapseAll}
    />
  );
  return (
    <div className="preview-change-summary" ref={chromeRef}>
      <span className="preview-change-summary-label">{summary}</span>
      <div className="preview-change-summary-actions">
        {viewPrefs && onViewPrefsChange ? (
          <>
            <ChangeListAction
              label="Show full file"
              title={
                viewPrefs.preferFullFile
                  ? "Collapse unmodified gaps — show change hunks only"
                  : "Reveal every unmodified gap in expanded files"
              }
              pressed={viewPrefs.preferFullFile}
              icon={viewPrefs.preferFullFile ? FoldVertical : UnfoldVertical}
              onClick={() =>
                onViewPrefsChange({
                  preferFullFile: !viewPrefs.preferFullFile,
                })
              }
            />
            <ChangeListAction
              label="Wrap"
              title={
                viewPrefs.wrap
                  ? "Unwrap long lines — scroll horizontally"
                  : "Wrap long lines inside the diff pane"
              }
              pressed={viewPrefs.wrap}
              icon={WrapText}
              onClick={() => onViewPrefsChange({ wrap: !viewPrefs.wrap })}
            />
            <ChangeListAction
              label="Dual #"
              title={
                viewPrefs.dualGutter
                  ? "Show a single line-number column"
                  : "Show both old and new line numbers"
              }
              pressed={viewPrefs.dualGutter}
              icon={Columns2}
              onClick={() =>
                onViewPrefsChange({ dualGutter: !viewPrefs.dualGutter })
              }
            />
            {collapseAction}
          </>
        ) : (
          collapseAction
        )}
      </div>
    </div>
  );
}
