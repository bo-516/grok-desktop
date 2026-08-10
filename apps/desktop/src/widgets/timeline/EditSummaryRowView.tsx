/**
 * Compact edit summary row for timeline tool cards (D3).
 * Opens the preview drawer instead of embedding full hunk review; the path is
 * shown shortened while `data-path` / copy keep the absolute path.
 */

import { FileCode2 } from "lucide-react";
import type { PathDisplay } from "@/lib/pathDisplay";
import type { EditContentSummary } from "@/lib/toolCardContent";
import { PathLabelView } from "@/widgets/shared";

export type EditSummaryRowViewProps = {
  /** Path + counts for one diff fragment (or no-diff-data path). */
  summary: EditContentSummary;
  /** Shortened label parts for `summary.path`, resolved against the workspace. */
  display: PathDisplay;
  /** True while this row shows the copied flash. */
  copied?: boolean;
  /** Open preview for this path (diff or file fallback). */
  onOpen: () => void;
  /** Copy the absolute path (double-click gesture). */
  onCopy: () => void;
};

/**
 * One-line `path  +N −M ›` button that opens the preview rail.
 * @param props Summary, display parts, copied flag and the two gesture handlers.
 */
export function EditSummaryRowView(props: EditSummaryRowViewProps) {
  const { summary, display, copied, onOpen, onCopy } = props;
  const counts = summary.noDiffData
    ? "no diff data"
    : `+${summary.added} −${summary.removed}${summary.degraded ? " ≈" : ""}${
        summary.hasBaseline ? "" : " · no baseline"
      }`;
  return (
    <button
      type="button"
      className="edit-summary-row"
      title={`${display.full}\nClick to preview · double-click to copy path`}
      onClick={(event) => {
        // detail > 1 is the second click of a double-click, which copies.
        if (event.detail > 1) {
          return;
        }
        onOpen();
      }}
      onDoubleClick={onCopy}
      data-kind="edit-summary"
      data-path={display.full}
    >
      <FileCode2
        className="edit-summary-icon"
        size={14}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <PathLabelView display={display} className="edit-summary-path" />
      <span className="edit-summary-counts">
        {copied ? "Copied" : counts}
      </span>
      <span className="edit-summary-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
