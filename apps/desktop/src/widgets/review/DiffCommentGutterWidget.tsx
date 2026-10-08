/**
 * Gutter affordance on one diff row: a hover "+" that starts (or, with
 * Shift, extends) a line-comment selection, plus the selection wash. Reads
 * the file's comment model from context; renders nothing in diffs that are
 * not commentable.
 */

import { Plus } from "lucide-react";
import { useDiffCommentFile } from "./DiffCommentContext";

export type DiffCommentGutterWidgetProps = {
  /** diffRowKey of the row this gutter belongs to. */
  rowKey: string;
};

/**
 * "+" button (and wash when selected) absolutely placed over the row gutter.
 * @param props Row key.
 * @returns Gutter chrome, or null without a comment model.
 */
export function DiffCommentGutterWidget(props: DiffCommentGutterWidgetProps) {
  const model = useDiffCommentFile();
  if (!model) {
    return null;
  }
  const selected = model.selectedKeys.has(props.rowKey);
  return (
    <>
      {selected ? <span className="diff-comment-wash" aria-hidden="true" /> : null}
      <button
        type="button"
        className="diff-comment-add"
        aria-label="Comment on this line"
        title="Comment on this line — Shift-click another line to select a range"
        onClick={(e) => model.onGutter(props.rowKey, e.shiftKey)}
      >
        <Plus aria-hidden="true" />
      </button>
    </>
  );
}
