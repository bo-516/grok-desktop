/**
 * Composer textarea with a mirror highlight layer for @file / /command tokens.
 * Selection and draft state stay with the parent; this is pure presentation
 * except local lightbox state for attachment previews (ephemeral UI chrome).
 * Supports paste images, drag-drop files, and a pending attachment strip
 * (thumbnail + remove) above the field — handlers from useComposerWidget.
 *
 * Attachment strip: browser-decodable images show an inline thumb; click opens
 * an in-app lightbox. HEIC / missing payload / decode failures fall back to
 * the label chip and open via the system default handler (Preview / download).
 * Thumbs sit out of flow inside a locked 56×56 tile so a large paste cannot
 * inflate the strip while the browser decodes.
 *
 * Only *committed* tokens paint — the ones picked from the completion menu,
 * which is the only place that knows the path exists. Commit stores a
 * zero-width mark instead of `@`/`/`, so the body can take the accent color
 * without a trigger gap and without shifting caret metrics. Freely typed
 * `@foo` renders as plain text: an accent on a path that resolves to nothing
 * would promise an attachment the agent never receives. Glyph metrics must not
 * change either way (no padding, margin, weight, or letter-spacing). Timeline
 * history uses the same `.composer-mention` accent (via MentionTextView) so
 * sent messages match the draft — no icon pill chrome on either surface.
 *
 * Field chrome (border / fill / radius) lives on `.composer-input-wrap` via
 * `data-state`. Idle and focus borders stay transparent so the field does not
 * draw a nested line box inside the card; listening / dragover still tint.
 * Padding must stay identical and duplicated on `.composer-input` and
 * `.composer-input-highlight` — the mirror is `absolute inset-0` against the
 * wrap padding box; moving padding onto the wrap desyncs caret alignment.
 */

import cs from "classnames";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from "react";
import { mentionKindClass, splitMentionTokens } from "@/lib/mentionTokens";
import {
  attachmentPreviewSrc,
  canInlinePreviewAttachment,
  openAttachmentExternally,
  type ImageAttachment,
} from "../../lib/mediaInput";
import { ImageLightboxView } from "@/widgets/shared";

/** Pixel box for a composer thumb — must match shortcut `w-14 h-14` (3.5rem @ 16px). */
const COMPOSER_THUMB_PX = 56;

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
  /**
   * IME composition lifecycle — parent uses these so Enter confirms candidates
   * instead of submitting the draft mid-composition.
   */
  onCompositionStart?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
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
 * Local state only tracks which attachment is open in the lightbox and which
 * thumbs failed to decode (switch to external-open fallback).
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
    onCompositionStart,
    onCompositionEnd,
    onScroll,
    onPaste,
    onDragOver,
    onDragLeave,
    onDrop,
    onRemoveAttachment,
  } = props;
  const segments = splitMentionTokens(draft);
  const fieldState = resolveFieldState(disabled, dragOver, listening);
  /** Index into `attachments` currently shown full-size; null when closed. */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /**
   * Attachment indexes whose <img> fired onError — treat as non-previewable so
   * the strip shows the label chip and clicks go to the system opener.
   */
  const [brokenIndexes, setBrokenIndexes] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const lightboxAtt =
    lightboxIndex != null ? (attachments[lightboxIndex] ?? null) : null;
  const lightboxSrc = lightboxAtt ? attachmentPreviewSrc(lightboxAtt) : "";

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  // Escape closes the lightbox without stealing other composer shortcuts.
  useEffect(() => {
    if (lightboxIndex == null) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightboxIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [lightboxIndex]);

  // Drop lightbox if the attachment list shrinks past the open index.
  useEffect(() => {
    if (lightboxIndex != null && lightboxIndex >= attachments.length) {
      setLightboxIndex(null);
    }
  }, [attachments.length, lightboxIndex]);

  /**
   * Whether this strip slot can show an <img> thumb right now.
   * @param att Attachment payload.
   * @param attIndex Index in the pending list (for broken-thumb tracking).
   */
  const canShowThumb = (att: ImageAttachment, attIndex: number): boolean => {
    return (
      canInlinePreviewAttachment(att) && !brokenIndexes.has(attIndex)
    );
  };

  /**
   * Open inline lightbox for previewable images; otherwise system Preview / download.
   * @param att Attachment clicked.
   * @param attIndex Index for lightbox state and broken-thumb tracking.
   */
  const handleOpenAttachment = (
    att: ImageAttachment,
    attIndex: number,
  ): void => {
    if (canShowThumb(att, attIndex)) {
      setLightboxIndex(attIndex);
      return;
    }
    openAttachmentExternally(att);
  };

  /**
   * Mark a thumb as non-previewable after decode failure (corrupt / odd mime).
   * @param attIndex Attachment index that failed.
   */
  const handleThumbError = (attIndex: number): void => {
    setBrokenIndexes((prev) => {
      if (prev.has(attIndex)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(attIndex);
      return next;
    });
  };

  return (
    <div
      className="composer-input-stack"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Outside the field wrap so absolute highlight/caret layers never cover thumbs. */}
      {attachments.length > 0 ? (
        <ul className="composer-attachments" aria-label="Image attachments">
          {attachments.map((att, attIndex) => {
            const previewSrc = attachmentPreviewSrc(att);
            const label = att.name ?? "image";
            const showThumb = canShowThumb(att, attIndex);
            const openLabel = showThumb
              ? `Preview ${label}`
              : `Open ${label} with system viewer`;
            return (
              <li
                key={`${att.mimeType}:${label}:${att.data.slice(0, 24)}`}
                className="composer-attachment group"
              >
                <button
                  type="button"
                  className="composer-attachment-open"
                  aria-label={openLabel}
                  title={
                    showThumb
                      ? `${label} (${att.mimeType}) — click to preview`
                      : `${label} (${att.mimeType}) — click to open with system viewer`
                  }
                  onClick={() => handleOpenAttachment(att, attIndex)}
                >
                  {showThumb && previewSrc ? (
                    <>
                      <span
                        className="composer-attachment-fallback"
                        aria-hidden="true"
                      >
                        {label}
                      </span>
                      <img
                        className="composer-attachment-thumb"
                        src={previewSrc}
                        alt={label}
                        width={COMPOSER_THUMB_PX}
                        height={COMPOSER_THUMB_PX}
                        draggable={false}
                        onError={() => handleThumbError(attIndex)}
                      />
                    </>
                  ) : (
                    <span className="composer-attachment-fallback">
                      {label}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label={`Remove ${label}`}
                  title="Remove attachment"
                  onClick={() => onRemoveAttachment?.(attIndex)}
                >
                  <X
                    className="composer-attachment-remove-icon"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div
        className="composer-input-wrap"
        data-state={fieldState}
        data-drag-over={dragOver ? "1" : undefined}
      >
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
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onScroll={onScroll}
          onPaste={onPaste}
        />
      </div>
      {lightboxAtt && lightboxSrc ? (
        <ImageLightboxView
          src={lightboxSrc}
          alt={lightboxAtt.name ?? "image"}
          onClose={closeLightbox}
        />
      ) : null}
    </div>
  );
}
