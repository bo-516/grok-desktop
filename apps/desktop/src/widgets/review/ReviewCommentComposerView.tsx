/**
 * Stateless inline composer for a new line comment (under the last selected
 * row). The widget owns the draft text; ⌘/Ctrl+Enter adds, Escape cancels.
 */

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ReviewCommentComposerViewProps = {
  /** Selection label, e.g. "src/a.ts:3-5". */
  label: string;
  /** Draft text. */
  text: string;
  /** Draft edits. */
  onTextChange: (next: string) => void;
  /** Add the comment (ignored by the parent when blank). */
  onSubmit: () => void;
  /** Close without adding. */
  onCancel: () => void;
};

/**
 * Label, textarea and Add / Cancel.
 * @param props Draft + handlers.
 * @returns Composer element.
 */
export function ReviewCommentComposerView(props: ReviewCommentComposerViewProps) {
  const blank = props.text.trim() === "";
  return (
    <div className="diff-comment-composer" data-kind="review-comment-composer">
      <span className="diff-comment-card-head">Comment on {props.label}</span>
      <Textarea
        value={props.text}
        placeholder="What should the agent change here?"
        aria-label={`Comment on ${props.label}`}
        className="max-h-[180px]"
        autoFocus
        onChange={(e) => props.onTextChange(e.target.value)}
        onKeyDown={(e) => {
          // Keep both keys local: Escape would otherwise close the drawer.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            props.onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={blank} onClick={props.onSubmit}>
          Add comment
        </Button>
      </div>
    </div>
  );
}
