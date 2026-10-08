/**
 * Per-file review-comment model handed down to diff rows through React
 * context, so DiffRowView (several layers below the git file widget) can
 * paint the gutter "+", the selection wash, the inline composer and saved
 * comments without threading props through PreviewDiffWidget / View.
 * Diffs without a provider (tool cards, file previews) get null and render
 * no comment chrome.
 */

import { createContext, useContext } from "react";
import type { ReviewComment } from "@/lib/reviewComments";

/** What a diff row needs to know about comments in its file. */
export type DiffCommentFileModel = {
  /** Repo-relative path of the file. */
  path: string;
  /** Row keys inside the active selection of this file (empty when none). */
  selectedKeys: ReadonlySet<string>;
  /** Row key the inline composer renders under ("" when no composer here). */
  composerKey: string;
  /** Location label of the active selection ("a.ts:3-5"; "" when none). */
  composerLabel: string;
  /** Saved comments of this file. */
  comments: readonly ReviewComment[];
  /**
   * Gutter click on a row.
   * @param rowKey diffRowKey of the row.
   * @param extend True for Shift-click (extend the selection).
   */
  onGutter: (rowKey: string, extend: boolean) => void;
  /** Close the composer / drop the selection. */
  onCancel: () => void;
  /** Add the composer text as a comment on the selection. */
  onSubmit: (body: string) => void;
  /** Remove a saved comment. */
  onRemove: (id: string) => void;
};

/** Context carrying the file model; null outside the git change list. */
export const DiffCommentFileContext = createContext<DiffCommentFileModel | null>(null);

/**
 * Read the enclosing file's comment model.
 * @returns Model, or null when the diff is not commentable.
 */
export function useDiffCommentFile(): DiffCommentFileModel | null {
  return useContext(DiffCommentFileContext);
}
