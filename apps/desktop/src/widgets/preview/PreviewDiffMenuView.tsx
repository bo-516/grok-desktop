/**
 * Stateless floating ⋯ menu for one file diff: Show full file, Dual line
 * numbers, Wrap lines. Floats over the scroll area (no full-width toolbar
 * band) so the narrow drawer keeps vertical space for code. Open state,
 * outside-click close and pref writes are owned by usePreviewDiffWidget.
 */

import { MoreHorizontal } from "lucide-react";
import type { Ref } from "react";
import { FULL_FILE_LINE_GATE } from "@/lib/diffGapExpand";

export type PreviewDiffMenuViewProps = {
  /**
   * Anchor node the owner uses for outside-click detection. Must wrap both
   * the toggle and the menu, otherwise clicking an item counts as outside.
   */
  anchorRef: Ref<HTMLDivElement>;
  /** Whether the menu list is rendered under the toggle. */
  open: boolean;
  /** Sticky full-file intent (checked state of Show full file). */
  preferFullFile: boolean;
  /** File exceeds FULL_FILE_LINE_GATE; disables turning full-file on. */
  fullFileBlocked: boolean;
  /** Dual old/new gutter pref (checked state of Dual line numbers). */
  dualGutter: boolean;
  /** Soft-wrap pref (checked state of Wrap lines). */
  wrap: boolean;
  /** Flip the menu open / closed (⋯ button). */
  onToggleOpen: () => void;
  /** Toggle sticky full-file; the owner also closes the menu. */
  onToggleFullFile: () => void;
  /** Toggle dual gutters; the owner also closes the menu. */
  onToggleDualGutter: () => void;
  /** Toggle soft wrap; the owner also closes the menu. */
  onToggleWrap: () => void;
};

/**
 * Tooltip for the sticky full-file menu item (on / off / blocked).
 * @param preferFullFile Whether full-file is currently on.
 * @param fullFileBlocked Whether the file is too large to expand fully.
 * @returns Hint describing what the click does now; "on" wins over blocked
 *   because turning full-file off is always allowed.
 */
function fullFileMenuTitle(
  preferFullFile: boolean,
  fullFileBlocked: boolean,
): string {
  if (preferFullFile) {
    return "Collapse unmodified gaps — show change hunks only";
  }
  if (fullFileBlocked) {
    return `Files over ${FULL_FILE_LINE_GATE} lines cannot expand fully`;
  }
  return "Reveal every unmodified gap";
}

/**
 * ⋯ toggle plus the three display-option items.
 * @param props Open state, current prefs, and item callbacks.
 * @returns Menu anchor; the item list only mounts while `open`.
 */
export function PreviewDiffMenuView(props: PreviewDiffMenuViewProps) {
  return (
    <div className="preview-diff-menu-anchor" ref={props.anchorRef}>
      <button
        type="button"
        className="btn-ghost"
        aria-label="Diff display options"
        aria-expanded={props.open}
        aria-haspopup="menu"
        onClick={props.onToggleOpen}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {props.open ? (
        <div className="preview-diff-menu" role="menu">
          <button
            type="button"
            className="preview-diff-menu-item"
            role="menuitem"
            aria-pressed={props.preferFullFile}
            disabled={props.fullFileBlocked && !props.preferFullFile}
            title={fullFileMenuTitle(props.preferFullFile, props.fullFileBlocked)}
            onClick={props.onToggleFullFile}
          >
            {props.preferFullFile ? "✓ " : ""}Show full file
            {props.fullFileBlocked && !props.preferFullFile ? " (too large)" : ""}
          </button>
          <button
            type="button"
            className="preview-diff-menu-item"
            role="menuitem"
            aria-pressed={props.dualGutter}
            onClick={props.onToggleDualGutter}
          >
            {props.dualGutter ? "✓ " : ""}Dual line numbers
          </button>
          <button
            type="button"
            className="preview-diff-menu-item"
            role="menuitem"
            aria-pressed={props.wrap}
            onClick={props.onToggleWrap}
          >
            {props.wrap ? "✓ " : ""}Wrap lines
          </button>
        </div>
      ) : null}
    </div>
  );
}
