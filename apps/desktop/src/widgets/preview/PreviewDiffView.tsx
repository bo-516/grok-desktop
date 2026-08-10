/**
 * Stateless structured diff body: dual gutters, hunks, collapsible gaps,
 * and a degraded banner when the engine bailed.
 */

import cs from "classnames";
import type { DiffGap, DiffHunkBlock, FileDiff } from "@/lib/diffCore";

export type PreviewDiffViewProps = {
  /** Structured file diff from buildFileDiff. */
  fileDiff: FileDiff;
  /** Optional path shown above the first hunk. */
  path?: string;
};

/**
 * Render one FileDiff as dual-gutter unified hunks with foldable gaps.
 * @param props Structured diff + optional path label.
 */
export function PreviewDiffView(props: PreviewDiffViewProps) {
  const { fileDiff, path } = props;
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
        fileDiff.blocks.map((block, i) =>
          block.kind === "gap" ? (
            <GapRow key={`g-${i}-${block.oldStart}`} gap={block} />
          ) : (
            <HunkBlock key={`h-${i}-${block.oldStart}`} hunk={block} />
          ),
        )
      )}
    </div>
  );
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
 * @param props Hunk block from FileDiff.
 */
function HunkBlock(props: { hunk: DiffHunkBlock }) {
  const { hunk } = props;
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
      {hunk.rows.map((row, i) => (
        <div
          key={`${row.type}:${row.oldNo ?? ""}:${row.newNo ?? ""}:${i}`}
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
          <span className="preview-diff-mark">
            {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
          </span>
          <span className="preview-diff-text">{row.text}</span>
        </div>
      ))}
    </div>
  );
}
