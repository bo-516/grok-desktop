/**
 * Stateless structured diff body: dual gutters, hunks, collapsible gaps,
 * and a degraded banner when the engine bailed.
 */

import cs from "classnames";
import type { CodeLine } from "@/lib/codeHighlight";
import type { DiffGap, DiffHunkBlock, FileDiff } from "@/lib/diffCore";
import { diffRowTokens } from "@/lib/diffLineTokens";
import { CodeLineView } from "@/widgets/shared";

export type PreviewDiffViewProps = {
  /** Structured file diff from buildFileDiff. */
  fileDiff: FileDiff;
  /** Optional path shown above the first hunk. */
  path?: string;
  /**
   * Tokens for the whole pre-edit file, indexed by 0-based line. Whole-file
   * (not per-row) on purpose: a diff row taken alone loses the multi-line
   * context TextMate needs, so a line inside a block comment or template
   * literal would be mis-colored.
   */
  oldLines?: CodeLine[];
  /** Tokens for the whole post-edit file, indexed by 0-based line. */
  newLines?: CodeLine[];
};

/**
 * Render one FileDiff as dual-gutter unified hunks with foldable gaps.
 * @param props Structured diff + optional path label.
 */
export function PreviewDiffView(props: PreviewDiffViewProps) {
  const { fileDiff, path, oldLines, newLines } = props;
  return (
    <div className="preview-diff" data-kind="preview-diff">
      {fileDiff.degraded ? (
        <div className="preview-banner preview-banner-warn" role="status">
          Diff is too large — showing whole-file replace (degraded).
        </div>
      ) : null}
      {path ? <div className="preview-diff-path">{path}</div> : null}
      {fileDiff.blocks.length === 0 ? (
        <div className="preview-empty">No changes</div>
      ) : (
        /* Keys come from the block's own line span, not its array index: spans
         * are strictly increasing and unique within a file diff, so a re-diff
         * that inserts a hunk does not remount every block after it. */
        fileDiff.blocks.map((block) =>
          block.kind === "gap" ? (
            <GapRow
              key={`g-${block.oldStart}-${block.newStart}`}
              gap={block}
            />
          ) : (
            <HunkBlock
              key={`h-${block.oldStart}-${block.newStart}`}
              hunk={block}
              oldLines={oldLines}
              newLines={newLines}
            />
          ),
        )
      )}
    </div>
  );
}

/**
 * Unified-diff marker column character for one row.
 * @param type Row kind from buildFileDiff.
 * @returns "+", "−" (figure dash, matching the gutter width), or a space for
 *   context rows so every row occupies the same marker cell.
 */
function diffRowMark(type: "same" | "add" | "del"): string {
  if (type === "add") {
    return "+";
  }
  if (type === "del") {
    return "−";
  }
  return " ";
}

/**
 * Collapsed unmodified span control (display only in S1 — always shows count).
 * @param props Gap block metadata.
 */
function GapRow(props: { gap: DiffGap }) {
  const { gap } = props;
  return (
    <div
      className="preview-diff-gap"
      data-kind="diff-gap"
      title={`Unmodified lines starting at old ${gap.oldStart} / new ${gap.newStart}`}
    >
      {gap.count} unmodified lines
    </div>
  );
}

/**
 * One hunk with dual gutters and add/del/same rows.
 * @param props Hunk block from FileDiff plus whole-file tokens for both sides;
 *   omitting the tokens renders the hunk as plain text.
 */
function HunkBlock(props: {
  hunk: DiffHunkBlock;
  oldLines?: CodeLine[];
  newLines?: CodeLine[];
}) {
  const { hunk, oldLines, newLines } = props;
  return (
    <div
      className="preview-diff-hunk"
      data-kind="diff-hunk"
      data-old-start={hunk.oldStart}
      data-new-start={hunk.newStart}
    >
      <div className="preview-diff-hunk-head">
        @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
      </div>
      {/* Type + dual line numbers already identify a row uniquely: every row
        * consumes a number on at least one side, so no two rows in a hunk can
        * collide and the array index adds nothing but churn on re-diff. */}
      {hunk.rows.map((row) => (
        <div
          key={`${row.type}:${row.oldNo ?? ""}:${row.newNo ?? ""}`}
          className={cs("preview-diff-row", {
            "preview-diff-row-add": row.type === "add",
            "preview-diff-row-del": row.type === "del",
          })}
          data-type={row.type}
        >
          <span className="preview-diff-oldno">
            {row.oldNo !== undefined ? row.oldNo : ""}
          </span>
          <span className="preview-diff-newno">
            {row.newNo !== undefined ? row.newNo : ""}
          </span>
          <span className="preview-diff-mark">{diffRowMark(row.type)}</span>
          <span className="preview-diff-text">
            <CodeLineView
              text={row.text}
              tokens={diffRowTokens(row, oldLines, newLines)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
