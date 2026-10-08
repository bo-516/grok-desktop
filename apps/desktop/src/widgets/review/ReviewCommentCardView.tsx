/**
 * Stateless saved review comment shown under the line it ends on.
 */

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCommentLocation, type ReviewComment } from "@/lib/reviewComments";

export type ReviewCommentCardViewProps = {
  /** Comment to show. */
  comment: ReviewComment;
  /** Remove it from the review. */
  onRemove: (id: string) => void;
};

/**
 * Location + text + remove.
 * @param props Comment and remove handler.
 * @returns Card element.
 */
export function ReviewCommentCardView(props: ReviewCommentCardViewProps) {
  const { comment } = props;
  return (
    <div className="diff-comment-card" data-kind="review-comment">
      <div className="diff-comment-card-head">
        <span className="min-w-0 flex-1 truncate">{formatCommentLocation(comment)}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Remove comment"
          title="Remove comment"
          onClick={() => props.onRemove(comment.id)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="diff-comment-card-body">{comment.body}</p>
    </div>
  );
}
