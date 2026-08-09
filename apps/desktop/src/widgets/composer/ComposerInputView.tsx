/**
 * Composer textarea with a mirror highlight layer for @file / /command tokens.
 * Selection and draft state stay with the parent; this is pure presentation.
 * Supports paste images and drag-drop files (handlers from useComposerWidget).
 *
 * Committed tokens store a zero-width mark instead of `@`/`/`, so the body can
 * paint in the accent color without a trigger gap and without shifting caret
 * metrics. Incomplete visible `@`/`/` (while typing) still render in the mirror
 * so the user sees the active trigger. Glyph metrics must not change otherwise
 * (no padding, margin, weight, or letter-spacing). Timeline history still uses
 * full MentionChipView pills (icon + label, no raw trigger).
 */

import cs from "classnames";
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  RefObject,
  UIEvent,
} from "react";
import {
  isVisibleMentionTrigger,
  mentionKindClass,
  splitMentionTokens,
} from "@/lib/mentionTokens";
import type { ImageAttachment } from "../../lib/mediaInput";

type ComposerInputViewProps = {
  draft: string;
  placeholder: string;
  disabled: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaActivedescendant?: string;
  /** Pending image attachments to preview before send. */
  attachments?: ImageAttachment[];
  /** Highlight when a file is dragged over. */
  dragOver?: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSelect: (event: { currentTarget: HTMLTextAreaElement }) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScroll?: (event: UIEvent<HTMLTextAreaElement>) => void;
  /** Optional paste handler for image attachments (F-MEDIA-03). */
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onRemoveAttachment?: (index: number) => void;
};

/**
 * Renders synchronized plain text + mention pills under a transparent textarea.
 * @param props Draft, a11y wiring, drop zone, and caret-preserving event handlers.
 */
export function ComposerInputView(props: ComposerInputViewProps) {
  const {
    draft,
    placeholder,
    disabled,
    textareaRef,
    ariaControls,
    ariaExpanded,
    ariaActivedescendant,
    attachments = [],
    dragOver = false,
    onChange,
    onSelect,
    onKeyDown,
    onScroll,
    onPaste,
    onDragOver,
    onDragLeave,
    onDrop,
    onRemoveAttachment,
  } = props;
  const segments = splitMentionTokens(draft);

  return (
    <div
      className={cs("composer-input-wrap", {
        "composer-input-dragover": dragOver,
      })}
      data-drag-over={dragOver ? "1" : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {attachments.length > 0 ? (
        <ul className="composer-attachments" aria-label="Image attachments">
          {attachments.map((att, attIndex) => (
            <li
              key={`${att.mimeType}:${att.name ?? "image"}:${att.data.slice(0, 24)}`}
              className="composer-attachment"
            >
              <span>
                {att.name ?? "image"} ({att.mimeType})
              </span>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onRemoveAttachment?.(attIndex)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="composer-input-highlight" aria-hidden="true">
        {segments.map((seg) => {
          if (seg.type === "text") {
            return <span key={`t-${seg.offset}`}>{seg.text}</span>;
          }
          return (
            <span
              key={`m-${seg.offset}`}
              className={cs("composer-mention", mentionKindClass(seg.kind))}
              data-mention-kind={seg.kind}
            >
              {/* Always keep the trigger char in the DOM so metrics match the
                  textarea. Zero-width marks are invisible; live `@`/`/` paint. */}
              <span
                className={cs("composer-mention-trigger", {
                  "composer-mention-trigger-live": isVisibleMentionTrigger(
                    seg.trigger,
                  ),
                })}
              >
                {seg.trigger}
              </span>
              {seg.body}
            </span>
          );
        })}
        {/* trailing newline keeps height in sync when draft ends with \\n */}
        {draft.endsWith("\n") ? "\n" : null}
      </div>
      <textarea
        ref={textareaRef}
        className="composer-input"
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        rows={2}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-activedescendant={ariaActivedescendant}
        onChange={onChange}
        onSelect={onSelect}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        onPaste={onPaste}
      />
    </div>
  );
}
