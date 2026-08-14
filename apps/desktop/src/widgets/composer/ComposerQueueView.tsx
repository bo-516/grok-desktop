/**
 * Stateless follow-up panel above the composer card (Codex / Claude queue).
 * Renders as its own surface — sibling of `.composer`, never inside the input
 * card — so queued text cannot be read as part of the draft field.
 * Each row is one prompt that will send after the current turn: a 1-based
 * index (1 drains next), the text, and Send now / Edit / Cancel. Action
 * icons stay hidden until hover or keyboard focus (literal `group` on the
 * row). Parent owns the queue and the three actions.
 */

import { Pencil, Send, X } from "lucide-react";
import type { PromptQueueItem } from "@/lib/promptQueue";

export type ComposerQueueViewProps = {
  /** Canvas-scoped follow-ups, enqueue order (index 0 drains next). */
  items: PromptQueueItem[];
  /**
   * Interrupt the live turn and send this row next.
   * @param id {@link PromptQueueItem.id} of the clicked row.
   */
  onSendNow: (id: string) => void;
  /**
   * Pull the row back into the composer for editing.
   * @param id {@link PromptQueueItem.id} of the clicked row.
   */
  onEdit: (id: string) => void;
  /**
   * Drop the row without sending.
   * @param id {@link PromptQueueItem.id} of the clicked row.
   */
  onCancel: (id: string) => void;
};

/**
 * Renders queued follow-ups as a numbered stack of chips above the composer.
 * @param props Items and the three grok-build row actions; empty list → null.
 * @returns Queue list, or null when there is nothing waiting.
 */
export function ComposerQueueView(props: ComposerQueueViewProps) {
  if (props.items.length === 0) {
    return null;
  }
  /** Canvas queue length — shared `aria-setsize` for every row. */
  const total = props.items.length;
  return (
    <ul className="composer-queue" aria-label="Queued follow-ups">
      {props.items.map((item, index) => {
        /** 1-based enqueue order; 1 is the next prompt to drain. */
        const position = index + 1;
        return (
          <li
            key={item.id}
            className="composer-queue-row group"
            aria-label={`Queued follow-up ${position}`}
            aria-posinset={position}
            aria-setsize={total}
          >
            <span className="composer-queue-index" aria-hidden="true">
              {position}
            </span>
            <span className="composer-queue-text" title={item.text}>
              {item.text}
            </span>
            <div className="composer-queue-actions">
              <button
                type="button"
                className="composer-queue-icon"
                title="Send now"
                aria-label="Send now"
                onClick={() => props.onSendNow(item.id)}
              >
                <Send className="composer-queue-icon-svg" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="composer-queue-icon"
                title="Edit"
                aria-label="Edit"
                onClick={() => props.onEdit(item.id)}
              >
                <Pencil className="composer-queue-icon-svg" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="composer-queue-icon"
                title="Cancel"
                aria-label="Cancel"
                onClick={() => props.onCancel(item.id)}
              >
                <X className="composer-queue-icon-svg" aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
