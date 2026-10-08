/**
 * Stateless review tray pinned to the bottom of the git change list: the
 * session's line comments with remove, Clear, and "Send to agent" (which
 * queues behind a streaming turn). Hidden when there is nothing to show.
 */

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCommentLocation } from "@/lib/reviewComments";
import type { ReviewCommentsModel } from "./useReviewCommentsWidget";

export type ReviewTrayViewProps = Pick<
  ReviewCommentsModel,
  "comments" | "sending" | "turnBusy" | "notice" | "onRemove" | "onClear" | "onSend"
>;

/**
 * Comment list + actions.
 * @param props Review model fields.
 * @returns Tray, or null with no comments and no notice.
 */
export function ReviewTrayView(props: ReviewTrayViewProps) {
  const { comments, sending, turnBusy, notice } = props;
  if (comments.length === 0 && !notice) {
    return null;
  }
  const count = comments.length;
  const sendLabel = turnBusy ? "Queue for agent" : "Send to agent";
  return (
    <section className="review-tray" aria-label="Review comments" data-kind="review-tray">
      {count > 0 ? (
        <ul className="review-tray-list">
          {comments.map((c) => (
            <li key={c.id} className="review-tray-item">
              <span className="review-tray-loc" title={formatCommentLocation(c)}>
                {formatCommentLocation(c)}
              </span>
              <span className="review-tray-body" title={c.body}>
                {c.body}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`Remove comment on ${formatCommentLocation(c)}`}
                onClick={() => props.onRemove(c.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="review-tray-actions">
        <span className="review-tray-notice" role="status">
          {notice || `${count} comment${count === 1 ? "" : "s"}${turnBusy ? " · sends after the current turn" : ""}`}
        </span>
        {count > 0 ? (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={props.onClear}>
              Clear
            </Button>
            <Button type="button" size="sm" disabled={sending} onClick={props.onSend}>
              {sending ? "Sending…" : sendLabel}
            </Button>
          </span>
        ) : null}
      </div>
    </section>
  );
}
