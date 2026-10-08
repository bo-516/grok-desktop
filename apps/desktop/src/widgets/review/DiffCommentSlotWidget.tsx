/**
 * Slot painted right after a diff row: saved comments that end on the row
 * and, when the active selection ends here, the inline composer. The draft
 * text sinks into this widget (high-frequency input never reaches the panel).
 */

import { useState } from "react";
import { diffRowKey } from "@/lib/diffChangeRuns";
import type { DiffRow } from "@/lib/diffCore";
import { commentsEndingAtRow } from "@/lib/reviewComments";
import { useDiffCommentFile } from "./DiffCommentContext";
import { ReviewCommentCardView } from "./ReviewCommentCardView";
import { ReviewCommentComposerView } from "./ReviewCommentComposerView";

export type DiffCommentSlotWidgetProps = {
  /** The row the slot follows. */
  row: DiffRow;
};

/**
 * Composer with its own draft state (mounted only while open).
 * @param props Label + submit / cancel from the file model.
 * @returns Composer view.
 */
function ComposerWidget(props: { label: string; onSubmit: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <ReviewCommentComposerView
      label={props.label}
      text={text}
      onTextChange={setText}
      onSubmit={() => {
        if (text.trim()) {
          props.onSubmit(text);
        }
      }}
      onCancel={props.onCancel}
    />
  );
}

/**
 * Comments / composer under one row.
 * @param props Row.
 * @returns Slot, or null when nothing belongs under this row.
 */
export function DiffCommentSlotWidget(props: DiffCommentSlotWidgetProps) {
  const model = useDiffCommentFile();
  if (!model) {
    return null;
  }
  const comments = commentsEndingAtRow(model.comments, model.path, props.row);
  const composer = model.composerKey !== "" && model.composerKey === diffRowKey(props.row);
  if (comments.length === 0 && !composer) {
    return null;
  }
  return (
    <div className="diff-comment-slot" data-kind="review-comment-slot">
      {comments.map((c) => (
        <ReviewCommentCardView key={c.id} comment={c} onRemove={model.onRemove} />
      ))}
      {composer ? (
        <ComposerWidget label={model.composerLabel} onSubmit={model.onSubmit} onCancel={model.onCancel} />
      ) : null}
    </div>
  );
}
