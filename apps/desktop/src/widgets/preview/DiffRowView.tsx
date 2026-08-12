/**
 * Stateless single structured-diff row: line number(s), semantic +/− mark,
 * highlighted text with optional word emph, and optional run accept/reject.
 */

import cs from "classnames";
import { memo, useEffect, useRef } from "react";
import type { CodeLine } from "@/lib/codeHighlight";
import type { DiffRow } from "@/lib/diffCore";
import { diffRowTokens } from "@/lib/diffLineTokens";
import type { EmphRange } from "@/lib/diffWordRanges";
import type { HunkDecision } from "@/lib/diffHunkApply";
import { CodeLineView } from "@/widgets/shared";

export type DiffRowViewProps = {
  /** Dual-numbered row from buildFileDiff / expandGap. */
  row: DiffRow;
  /** Whole-file pre-edit tokens (0-based lines). */
  oldLines?: CodeLine[];
  /** Whole-file post-edit tokens (0-based lines). */
  newLines?: CodeLine[];
  /** When true, paint oldNo + newNo columns. */
  dualGutter?: boolean;
  /** Soft-wrap code text. */
  wrap?: boolean;
  /**
   * When true, line numbers are fragment-relative — show `~` prefix and
   * title so users do not treat them as absolute file line numbers.
   */
  relativeLineNumbers?: boolean;
  /** Line-local word emph ranges for this row. */
  emph?: EmphRange[];
  /**
   * Decision for the change run this row belongs to (all rows of the run).
   * Drives whole-run accepted/rejected outline — not only the chrome row.
   */
  runDecision?: HunkDecision;
  /**
   * When set, this row is the first of a change run and shows Accept/Reject.
   * `index` is the createDiffReview hunk index.
   */
  reviewRun?: {
    index: number;
    decision: HunkDecision;
    onDecide: (index: number, decision: "accept" | "reject") => void;
  };
  /** Brief focus wash after keyboard jump to a change run. */
  focused?: boolean;
};

/**
 * Resolve word-emph kind from row type (same rows never emph).
 * @param type Diff row kind.
 */
function emphKindForRow(type: DiffRow["type"]): "add" | "del" | undefined {
  if (type === "add") {
    return "add";
  }
  if (type === "del") {
    return "del";
  }
  return undefined;
}

/**
 * Single-column line number: del uses old, otherwise prefer new.
 * @param row Dual-numbered row.
 */
function singleLineNo(row: DiffRow): number | undefined {
  if (row.type === "del") {
    return row.oldNo;
  }
  if (row.newNo !== undefined) {
    return row.newNo;
  }
  return row.oldNo;
}

/**
 * Format a gutter number; relative mode prefixes `~` (fragment-local index).
 * @param n 1-based line number or undefined (empty gutter).
 * @param relative Whether the number is fragment-relative.
 */
function formatLineNo(
  n: number | undefined,
  relative: boolean,
): string {
  if (n === undefined) {
    return "";
  }
  return relative ? `~${n}` : String(n);
}

/**
 * One painted diff row. Memoized: parent re-renders on reveal/decision should
 * not re-paint every unchanged context line.
 */
function DiffRowViewInner(props: DiffRowViewProps) {
  const {
    row,
    oldLines,
    newLines,
    dualGutter,
    wrap,
    relativeLineNumbers = false,
    emph,
    runDecision,
    reviewRun,
    focused,
  } = props;
  const tokens = diffRowTokens(row, oldLines, newLines);
  const emphKind = emphKindForRow(row.type);
  const singleNo = singleLineNo(row);
  const rootRef = useRef<HTMLDivElement>(null);
  const noTitle = relativeLineNumbers ? "片段内相对行号" : undefined;

  // ⌥↓/⌥↑ lands here: scroll the focused run into view without lifting scroll
  // ownership out of the nearest overflow container.
  useEffect(() => {
    if (!focused) {
      return;
    }
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);

  const decision = runDecision ?? reviewRun?.decision ?? "pending";
  const hasReviewChrome = Boolean(reviewRun);

  return (
    <div
      ref={rootRef}
      className={cs("preview-diff-row", {
        "preview-diff-row-dual": dualGutter,
        "preview-diff-row-add": row.type === "add",
        "preview-diff-row-del": row.type === "del",
        "preview-diff-row-focus": focused,
        "preview-diff-row-accepted": decision === "accept",
        "preview-diff-row-rejected": decision === "reject",
      })}
      data-type={row.type}
      data-run-index={reviewRun?.index}
      data-decision={decision !== "pending" ? decision : undefined}
      data-relative-line={relativeLineNumbers ? "true" : undefined}
    >
      {dualGutter ? (
        <>
          <span
            className={cs("preview-diff-oldno", {
              "preview-diff-no-del": row.type === "del",
            })}
            title={noTitle}
          >
            {formatLineNo(row.oldNo, relativeLineNumbers)}
          </span>
          <span
            className={cs("preview-diff-newno", {
              "preview-diff-no-add": row.type === "add",
            })}
            title={noTitle}
          >
            {formatLineNo(row.newNo, relativeLineNumbers)}
          </span>
        </>
      ) : (
        <span
          className={cs("preview-diff-no", {
            "preview-diff-no-add": row.type === "add",
            "preview-diff-no-del": row.type === "del",
          })}
          title={noTitle}
        >
          {formatLineNo(singleNo, relativeLineNumbers)}
        </span>
      )}
      <span
        className={cs("preview-diff-mark", {
          "preview-diff-mark-add": row.type === "add",
          "preview-diff-mark-del": row.type === "del",
        })}
      >
        {diffRowMark(row.type)}
      </span>
      <span
        className={cs("preview-diff-text", {
          "preview-diff-text-wrap": wrap,
          "preview-diff-text-nowrap": !wrap,
          "preview-diff-text-review": hasReviewChrome,
        })}
      >
        <CodeLineView
          text={row.text}
          tokens={tokens}
          emph={emph}
          emphKind={emphKind}
        />
      </span>
      {reviewRun ? (
        <span className="preview-diff-run-actions">
          <button
            type="button"
            className={cs("preview-diff-run-btn", {
              "preview-diff-run-btn-active-accept":
                reviewRun.decision === "accept",
            })}
            aria-pressed={reviewRun.decision === "accept"}
            onClick={() => reviewRun.onDecide(reviewRun.index, "accept")}
          >
            Accept
          </button>
          <button
            type="button"
            className={cs("preview-diff-run-btn", {
              "preview-diff-run-btn-active-reject":
                reviewRun.decision === "reject",
            })}
            aria-pressed={reviewRun.decision === "reject"}
            onClick={() => reviewRun.onDecide(reviewRun.index, "reject")}
          >
            Reject
          </button>
        </span>
      ) : null}
    </div>
  );
}

export const DiffRowView = memo(DiffRowViewInner);

/**
 * Unified-diff marker column character for one row.
 * @param type Row kind from buildFileDiff.
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
