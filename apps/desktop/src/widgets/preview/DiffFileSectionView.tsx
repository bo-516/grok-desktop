/**
 * Stateless collapsible file section header for multi-file change lists.
 * Sticky head stays visible while the body scrolls; collapsed shows head only.
 * Path uses PathLabelView so the file name is never the truncated half.
 */

import cs from "classnames";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { DiffViewPrefs } from "@/lib/diffViewPrefs";
import type { PathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

export type DiffFileSectionViewProps = {
  /**
   * Path display parts from toPathDisplay; when omitted, falls back to raw
   * `path` string (tests / callers without workspace).
   */
  pathDisplay?: PathDisplay;
  /** Absolute or workspace-relative file path (title + tooltip / fallback). */
  path: string;
  /** Right-side meta (+N −M, status tags). */
  meta?: ReactNode;
  /** Whether the file body is expanded. */
  expanded: boolean;
  /** Toggle expand/collapse. */
  onToggle: () => void;
  /** Diff body (or fallback actions) rendered only when expanded. */
  children?: ReactNode;
};

/**
 * One collapsible file block: sticky header + optional body.
 * @param props Path, meta, expand state, body.
 */
export function DiffFileSectionView(props: DiffFileSectionViewProps) {
  const { path, pathDisplay, meta, expanded, onToggle, children } = props;
  return (
    <section
      className="preview-change-file"
      data-kind="diff-file-section"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="preview-change-file-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="shrink-0 text-fg-muted" aria-hidden="true">
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} />
          )}
        </span>
        {pathDisplay ? (
          <PathLabelView
            display={pathDisplay}
            className="preview-change-file-path"
          />
        ) : (
          <span className="preview-change-file-path" title={path}>
            {path}
          </span>
        )}
        {meta ? (
          <span className="preview-change-file-meta">{meta}</span>
        ) : null}
      </button>
      {expanded ? children : null}
    </section>
  );
}

/**
 * "Collapse all / Expand all" control for the change-list summary strip,
 * plus shared wrap / dual-gutter / show-full-file prefs so the main Changes
 * entry is not a dead-end for display options.
 */
export type DiffChangeListChromeProps = {
  /** File count label text already computed by parent. */
  summary: ReactNode;
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

/**
 * Sticky summary row with bulk collapse + shared diff display prefs.
 * @param props Summary contents + bulk expand handlers + optional prefs.
 */
export function DiffChangeListChrome(props: DiffChangeListChromeProps) {
  const {
    summary,
    allCollapsed,
    onCollapseAll,
    onExpandAll,
    viewPrefs,
    onViewPrefsChange,
  } = props;
  return (
    <div className="preview-change-summary">
      <span className="min-w-0 flex-1">{summary}</span>
      {viewPrefs && onViewPrefsChange ? (
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            className="btn-ghost text-11px"
            aria-pressed={viewPrefs.preferFullFile}
            title={
              viewPrefs.preferFullFile
                ? "Collapse unmodified gaps — show change hunks only"
                : "Reveal every unmodified gap in expanded files"
            }
            onClick={() =>
              onViewPrefsChange({
                preferFullFile: !viewPrefs.preferFullFile,
              })
            }
          >
            {viewPrefs.preferFullFile ? "✓ " : ""}Show full file
          </button>
          <button
            type="button"
            className="btn-ghost text-11px"
            aria-pressed={viewPrefs.wrap}
            onClick={() => onViewPrefsChange({ wrap: !viewPrefs.wrap })}
          >
            {viewPrefs.wrap ? "✓ " : ""}Wrap
          </button>
          <button
            type="button"
            className="btn-ghost text-11px"
            aria-pressed={viewPrefs.dualGutter}
            onClick={() =>
              onViewPrefsChange({ dualGutter: !viewPrefs.dualGutter })
            }
          >
            {viewPrefs.dualGutter ? "✓ " : ""}Dual #
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={cs("btn-ghost")}
        onClick={allCollapsed ? onExpandAll : onCollapseAll}
      >
        {allCollapsed ? "Expand all" : "Collapse all"}
      </button>
    </div>
  );
}
