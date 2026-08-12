/**
 * Stateless structured diff body: expandable gaps, single-column gutters,
 * word emph, and optional per-change-run accept/reject (single-paint review).
 * No @@ hunk headers — fold bands are the separators.
 */

import cs from "classnames";
import type { CodeLine } from "@/lib/codeHighlight";
import {
  changeRunIndexByRowKey,
  changeRunsFromFileDiff,
  diffRowKey,
  type ChangeRun,
} from "@/lib/diffChangeRuns";
import type { DiffGap, DiffHunkBlock, DiffRow, FileDiff } from "@/lib/diffCore";
import {
  expandGap,
  gapRevealKey,
  revealAll,
  stepRevealBottom,
  stepRevealTop,
  type GapBandPosition,
  type GapReveal,
} from "@/lib/diffGapExpand";
import type { HunkDecision } from "@/lib/diffHunkApply";
import type { EmphRange } from "@/lib/diffWordRanges";
import { DiffGapBandView } from "./DiffGapBandView";
import { DiffRowView } from "./DiffRowView";

export type PreviewDiffReviewProps = {
  /** Decision keyed by change-run index (createDiffReview order). */
  decisionByIndex: Record<number, HunkDecision>;
  /**
   * Set decision for one run.
   * @param index Change-run index.
   * @param decision Accept or reject.
   */
  onDecide: (index: number, decision: "accept" | "reject") => void;
};

export type PreviewDiffViewProps = {
  /** Structured file diff from buildFileDiff. */
  fileDiff: FileDiff;
  /** Optional path shown above the first hunk. */
  path?: string;
  /**
   * Tokens for the whole pre-edit file, indexed by 0-based line. Whole-file
   * (not per-row) on purpose: a diff row taken alone loses the multi-line
   * context TextMate needs.
   */
  oldLines?: CodeLine[];
  /** Tokens for the whole post-edit file, indexed by 0-based line. */
  newLines?: CodeLine[];
  /** New-side source lines (for gap expand text). */
  newTextLines: string[];
  /** Old-side source lines (fallback for expand). */
  oldTextLines: string[];
  /** Per-gap reveal amounts; key = gapRevealKey(gap). */
  revealByGap: Record<string, GapReveal>;
  /**
   * Update reveal for one gap.
   * @param key gapRevealKey.
   * @param next Next top/bottom amounts.
   */
  onRevealChange: (key: string, next: GapReveal) => void;
  /** Dual old/new line-number columns. */
  dualGutter?: boolean;
  /** Soft-wrap code text. */
  wrap?: boolean;
  /** Fragment-relative gutters (`~` prefix) when disk is not aligned. */
  relativeLineNumbers?: boolean;
  /** Optional banner above the scroll (alignment / degraded). */
  banner?: string | null;
  /** rowKey → line-local emph ranges. */
  emphByRowKey?: Map<string, EmphRange[]>;
  /** Optional single-paint review chrome on change runs. */
  review?: PreviewDiffReviewProps;
  /** Change-run index currently focused by keyboard jump. */
  focusedRunIndex?: number | null;
};

/**
 * Render one FileDiff with expandable gaps and optional review actions.
 * @param props Structured diff + expand/review wiring from the widget shell.
 */
export function PreviewDiffView(props: PreviewDiffViewProps) {
  const {
    fileDiff,
    path,
    oldLines,
    newLines,
    newTextLines,
    oldTextLines,
    revealByGap,
    onRevealChange,
    dualGutter,
    wrap,
    relativeLineNumbers,
    banner,
    emphByRowKey,
    review,
    focusedRunIndex,
  } = props;

  const runs = changeRunsFromFileDiff(fileDiff);
  const runByRow = changeRunIndexByRowKey(runs);
  /** First row key of each run — only that row gets Accept/Reject chrome. */
  const firstKeyOfRun = firstRowKeys(runs);
  const blockCount = fileDiff.blocks.length;

  return (
    <div className="preview-diff" data-kind="preview-diff">
      {fileDiff.degraded ? (
        <div className="preview-banner preview-banner-warn" role="status">
          Diff is too large — showing whole-file replace (degraded).
        </div>
      ) : null}
      {banner ? (
        <div className="preview-banner preview-banner-warn" role="status">
          {banner}
        </div>
      ) : null}
      {path ? <div className="preview-diff-path">{path}</div> : null}
      {fileDiff.blocks.length === 0 ? (
        <div className="preview-empty">No changes</div>
      ) : (
        <div
          className={cs("preview-diff-scroll", {
            "preview-diff-scroll-nowrap": !wrap,
          })}
        >
          {fileDiff.blocks.map((block, index) =>
            block.kind === "gap" ? (
              <GapBlock
                key={`g-${block.oldStart}-${block.newStart}`}
                gap={block}
                position={gapPosition(index, blockCount)}
                newTextLines={newTextLines}
                oldTextLines={oldTextLines}
                reveal={revealByGap[gapRevealKey(block)]}
                onRevealChange={onRevealChange}
                oldLines={oldLines}
                newLines={newLines}
                dualGutter={dualGutter}
                wrap={wrap}
                relativeLineNumbers={relativeLineNumbers}
              />
            ) : (
              <HunkRows
                key={`h-${block.oldStart}-${block.newStart}`}
                hunk={block}
                oldLines={oldLines}
                newLines={newLines}
                dualGutter={dualGutter}
                wrap={wrap}
                relativeLineNumbers={relativeLineNumbers}
                emphByRowKey={emphByRowKey}
                review={review}
                runByRow={runByRow}
                firstKeyOfRun={firstKeyOfRun}
                focusedRunIndex={focusedRunIndex}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Map block index to fold-band icon position.
 * @param index 0-based index in fileDiff.blocks.
 * @param blockCount Total blocks.
 */
function gapPosition(index: number, blockCount: number): GapBandPosition {
  if (index === 0) {
    return "leading";
  }
  if (index === blockCount - 1) {
    return "trailing";
  }
  return "middle";
}

/**
 * Map each run index to its first painted row key.
 * @param runs Ordered change runs.
 */
function firstRowKeys(runs: ChangeRun[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const run of runs) {
    const first = run.rowKeys[0];
    if (first !== undefined) {
      map.set(run.index, first);
    }
  }
  return map;
}

/**
 * Expand one gap into head rows / remaining band / tail rows.
 */
function GapBlock(props: {
  gap: DiffGap;
  position: GapBandPosition;
  newTextLines: string[];
  oldTextLines: string[];
  reveal?: GapReveal;
  onRevealChange: (key: string, next: GapReveal) => void;
  oldLines?: CodeLine[];
  newLines?: CodeLine[];
  dualGutter?: boolean;
  wrap?: boolean;
  relativeLineNumbers?: boolean;
}) {
  const {
    gap,
    position,
    newTextLines,
    oldTextLines,
    reveal,
    onRevealChange,
    oldLines,
    newLines,
    dualGutter,
    wrap,
    relativeLineNumbers,
  } = props;
  const key = gapRevealKey(gap);
  const { head, remaining, tail } = expandGap(
    gap,
    newTextLines,
    oldTextLines,
    reveal,
  );

  return (
    <>
      {head.map((row) => (
        <DiffRowView
          key={diffRowKey(row)}
          row={row}
          oldLines={oldLines}
          newLines={newLines}
          dualGutter={dualGutter}
          wrap={wrap}
          relativeLineNumbers={relativeLineNumbers}
        />
      ))}
      {remaining ? (
        <DiffGapBandView
          gap={remaining}
          position={position}
          reveal={reveal}
          onRevealTop={() =>
            onRevealChange(key, stepRevealTop(gap.count, reveal))
          }
          onRevealBottom={() =>
            onRevealChange(key, stepRevealBottom(gap.count, reveal))
          }
          onRevealAll={() => onRevealChange(key, revealAll(gap.count))}
        />
      ) : null}
      {tail.map((row) => (
        <DiffRowView
          key={diffRowKey(row)}
          row={row}
          oldLines={oldLines}
          newLines={newLines}
          dualGutter={dualGutter}
          wrap={wrap}
          relativeLineNumbers={relativeLineNumbers}
        />
      ))}
    </>
  );
}

/**
 * Paint hunk rows (no @@ header) with optional review chrome on run starts.
 */
function HunkRows(props: {
  hunk: DiffHunkBlock;
  oldLines?: CodeLine[];
  newLines?: CodeLine[];
  dualGutter?: boolean;
  wrap?: boolean;
  relativeLineNumbers?: boolean;
  emphByRowKey?: Map<string, EmphRange[]>;
  review?: PreviewDiffReviewProps;
  runByRow: Map<string, number>;
  firstKeyOfRun: Map<number, string>;
  focusedRunIndex?: number | null;
}) {
  const {
    hunk,
    oldLines,
    newLines,
    dualGutter,
    wrap,
    relativeLineNumbers,
    emphByRowKey,
    review,
    runByRow,
    firstKeyOfRun,
    focusedRunIndex,
  } = props;

  return (
    <div
      className="preview-diff-hunk"
      data-kind="diff-hunk"
      data-old-start={hunk.oldStart}
      data-new-start={hunk.newStart}
    >
      {hunk.rows.map((row) => {
        const key = diffRowKey(row);
        const runIndex = runByRow.get(key);
        const isFirst =
          runIndex !== undefined && firstKeyOfRun.get(runIndex) === key;
        const decision =
          review && runIndex !== undefined
            ? (review.decisionByIndex[runIndex] ?? "pending")
            : undefined;
        const reviewRun =
          review && isFirst && runIndex !== undefined
            ? {
                index: runIndex,
                decision: decision ?? "pending",
                onDecide: review.onDecide,
              }
            : undefined;
        return (
          <DiffRowView
            key={key}
            row={row}
            oldLines={oldLines}
            newLines={newLines}
            dualGutter={dualGutter}
            wrap={wrap}
            relativeLineNumbers={relativeLineNumbers}
            emph={emphByRowKey?.get(key)}
            runDecision={decision}
            reviewRun={reviewRun}
            focused={
              focusedRunIndex !== null &&
              focusedRunIndex !== undefined &&
              runIndex === focusedRunIndex
            }
          />
        );
      })}
    </div>
  );
}

/** Re-export row type for tests that import the view module. */
export type { DiffRow };
