/**
 * Composer textarea with a mirror highlight layer for @file / /command tokens.
 * Selection and draft state stay with the parent; this is pure presentation.
 * Supports paste images and drag-drop files (handlers from useComposerWidget).
 *
 * Only *committed* tokens paint — the ones picked from the completion menu,
 * which is the only place that knows the path exists. Commit stores a
 * zero-width mark instead of `@`/`/`, so the body can take the accent color
 * without a trigger gap and without shifting caret metrics. Freely typed
 * `@foo` renders as plain text: an accent on a path that resolves to nothing
 * would promise an attachment the agent never receives. Glyph metrics must not
 * change either way (no padding, margin, weight, or letter-spacing). Timeline
 * history still uses full MentionChipView pills (icon + label, no raw trigger).
 *
 * Field chrome (border / fill / radius) lives on `.composer-input-wrap` via
 * `data-state`. Padding must stay identical and duplicated on `.composer-input`
 * and `.composer-input-highlight` — the mirror is `absolute inset-0` against the
 * wrap padding box; moving padding onto the wrap desyncs caret alignment.
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
import { mentionKindClass, splitMentionTokens } from "@/lib/mentionTokens";
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
  /**
   * Voice dictation active — drives wrap `data-state=listening` (color only).
   * Parent owns the boolean; missing/false is the idle look.
   */
  listening?: boolean;
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
 * Resolve wrap data-state for sole chrome ownership (color only, shared metrics).
 * Priority: disabled → dragover → listening → idle (focus via :focus-within CSS).
 * @param disabled When true, field is non-interactive.
 * @param dragOver File is dragged over the wrap.
 * @param listening Mic is capturing.
 * @returns Attribute value for `data-state` on the wrap.
 */
function resolveFieldState(
  disabled: boolean,
  dragOver: boolean,
  listening: boolean,
): "disabled" | "dragover" | "listening" | "idle" {
  if (disabled) {
    return "disabled";
  }
  if (dragOver) {
    return "dragover";
  }
  if (listening) {
    return "listening";
  }
  return "idle";
}

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
    listening = false,
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
  const fieldState = resolveFieldState(disabled, dragOver, listening);

  return (
    <div
      className="composer-input-wrap"
      data-state={fieldState}
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
          if (!seg.committed) {
            // Typed but never locked onto a workspace entry — plain draft text.
            return <span key={`m-${seg.offset}`}>{seg.text}</span>;
          }
          return (
            <span
              key={`m-${seg.offset}`}
              className={cs("composer-mention", mentionKindClass(seg.kind))}
              data-mention-kind={seg.kind}
            >
              {/* Keep the zero-width trigger in the DOM so the mirror consumes
                  exactly the draft's characters and caret metrics still match. */}
              <span className="composer-mention-trigger">{seg.trigger}</span>
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
        rows={1}
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
