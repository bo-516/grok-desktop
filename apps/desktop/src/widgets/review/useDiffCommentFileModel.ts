/**
 * Build one file's DiffCommentFileModel from the panel-level review model:
 * the full row list (so selections span folded context), the selected keys,
 * where the composer goes, and this file's saved comments. Memoized so rows
 * of untouched files do not re-render when another file's comments change.
 */

import { useCallback, useMemo } from "react";
import { diffRowKey } from "@/lib/diffChangeRuns";
import type { FileDiff } from "@/lib/diffCore";
import {
  formatCommentLocation,
  fullDiffRows,
  rowsLocation,
  selectionRows,
} from "@/lib/reviewComments";
import type { DiffCommentFileModel } from "./DiffCommentContext";
import type { ReviewCommentsModel } from "./useReviewCommentsWidget";

/** Inputs for {@link useDiffCommentFileModel}. */
export type DiffCommentFileInput = {
  /** Panel review model; null disables comments for this file. */
  review: ReviewCommentsModel | null;
  /** Repo-relative file path. */
  path: string;
  /** Structured diff of the file. */
  fileDiff: FileDiff;
  /** Whole old text (from the full-context patch). */
  oldText: string;
  /** Whole new text. */
  newText: string;
  /** False when line numbers are fragment-relative (comments disabled). */
  absoluteLines: boolean;
};

/**
 * Per-file comment model for DiffCommentFileContext.
 * @param input Review model, path, diff and texts.
 * @returns Model, or null when comments are unavailable for this file.
 */
export function useDiffCommentFileModel(input: DiffCommentFileInput): DiffCommentFileModel | null {
  const { review, path, fileDiff, oldText, newText, absoluteLines } = input;
  const rows = useMemo(
    () => fullDiffRows(fileDiff, oldText.split("\n"), newText.split("\n")),
    [fileDiff, oldText, newText],
  );
  const selection = review?.selection && review.selection.path === path ? review.selection : null;
  const anchorKey = selection?.anchorKey ?? "";
  const focusKey = selection?.focusKey ?? "";
  const allComments = review?.comments;
  const comments = useMemo(() => (allComments ?? []).filter((c) => c.path === path), [allComments, path]);
  const range = useMemo(
    () => (anchorKey ? selectionRows(rows, anchorKey, focusKey) : []),
    [rows, anchorKey, focusKey],
  );
  const reviewGutter = review?.onGutter;
  const reviewSubmit = review?.onSubmit;
  const onGutter = useCallback(
    (rowKey: string, extend: boolean) => reviewGutter?.(path, rowKey, extend),
    [reviewGutter, path],
  );
  const onSubmit = useCallback((body: string) => reviewSubmit?.(path, rows, body), [reviewSubmit, path, rows]);
  const onCancel = review?.onCancel;
  const onRemove = review?.onRemove;

  return useMemo(() => {
    if (!absoluteLines || !onCancel || !onRemove) {
      return null;
    }
    const last = range[range.length - 1];
    const loc = rowsLocation(range);
    return {
      path,
      selectedKeys: new Set(range.map(diffRowKey)),
      composerKey: last ? diffRowKey(last) : "",
      composerLabel: loc ? formatCommentLocation({ path, ...loc }) : "",
      comments,
      onGutter,
      onCancel,
      onSubmit,
      onRemove,
    };
  }, [absoluteLines, path, range, comments, onGutter, onCancel, onSubmit, onRemove]);
}
