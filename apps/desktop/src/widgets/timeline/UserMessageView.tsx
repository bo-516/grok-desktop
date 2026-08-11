/**
 * User timeline bubble: sent text (with @/ mention accents matching the
 * composer textarea) plus image ContentBlocks as clickable thumbnails. Click
 * opens the shared in-app lightbox (same surface as composer attach preview).
 * Resource / resource_link blocks stay off the bubble (agent payload only).
 *
 * Local state only tracks which image is open in the lightbox and which
 * thumbs failed to decode — high-frequency chrome stays out of the store.
 */

import { useCallback, useEffect, useState } from "react";
import {
  countImagePlaceholders,
  stripImagePlaceholders,
  userImagesFromBlocks,
  userTextFromBlocks,
  type ContentBlock,
  type UserImageBlock,
} from "@grok-desktop/acp-core";
import {
  attachmentPreviewSrc,
  canInlinePreviewAttachment,
  openAttachmentExternally,
  type ImageAttachment,
} from "@/lib/mediaInput";
import { ImageLightboxView, MentionTextView } from "@/widgets/shared";

export type UserMessageViewProps = {
  /** User row blocks from appendUserPrompt / seed / agent echo. */
  blocks: ContentBlock[];
  /** Find-in-timeline highlight on the text bubble. */
  highlight?: boolean;
};

/**
 * Map a timeline image block onto the composer ImageAttachment shape so
 * preview / external-open helpers stay single-source.
 * @param img Timeline image slice (mime + base64).
 * @param index 1-based index for a default label.
 * @returns Attachment payload for mediaInput helpers.
 */
function toAttachment(img: UserImageBlock, index: number): ImageAttachment {
  return {
    mimeType: img.mimeType,
    data: img.data,
    name: `image ${index}`,
  };
}

/**
 * Right-aligned user turn: optional image strip above text bubble.
 * @param props Blocks + optional find highlight; empty text+images → null.
 */
export function UserMessageView(props: UserMessageViewProps) {
  const { blocks, highlight = false } = props;
  const rawText = userTextFromBlocks(blocks);
  /**
   * Agent history may keep only `[Image #N]` stand-ins when binary blocks were
   * not persisted — strip those for the bubble body and surface chip counts.
   */
  const placeholderCount = countImagePlaceholders(rawText);
  const text = stripImagePlaceholders(rawText);
  const images = userImagesFromBlocks(blocks);
  const hasText = text.trim().length > 0;
  const hasImages = images.length > 0;
  /** Placeholders with no binary payload — show chips so the message is not bare. */
  const missingImageCount = hasImages
    ? 0
    : placeholderCount;
  /** Index into `images` currently shown full-size; null when closed. */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /**
   * Image indexes whose <img> fired onError — fall back to external open
   * instead of a broken lightbox.
   */
  const [brokenIndexes, setBrokenIndexes] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const lightboxImg =
    lightboxIndex != null ? (images[lightboxIndex] ?? null) : null;
  const lightboxAtt = lightboxImg
    ? toAttachment(lightboxImg, (lightboxIndex ?? 0) + 1)
    : null;
  const lightboxSrc = lightboxAtt ? attachmentPreviewSrc(lightboxAtt) : "";

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  // Escape closes the lightbox without stealing timeline find (⌘F) focus.
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

  // Drop lightbox if the block list shrinks past the open index (rare).
  useEffect(() => {
    if (lightboxIndex != null && lightboxIndex >= images.length) {
      setLightboxIndex(null);
    }
  }, [images.length, lightboxIndex]);

  /**
   * Whether this strip slot can show an <img> thumb right now.
   * @param img Timeline image block.
   * @param index Index in the strip (for broken-thumb tracking).
   */
  const canShowThumb = (img: UserImageBlock, index: number): boolean => {
    return (
      canInlinePreviewAttachment(toAttachment(img, index + 1)) &&
      !brokenIndexes.has(index)
    );
  };

  /**
   * Open inline lightbox for previewable images; otherwise system Preview.
   * @param img Image clicked.
   * @param index Index for lightbox state and broken-thumb tracking.
   */
  const handleOpenImage = (img: UserImageBlock, index: number): void => {
    if (canShowThumb(img, index)) {
      setLightboxIndex(index);
      return;
    }
    openAttachmentExternally(toAttachment(img, index + 1));
  };

  /**
   * Mark a thumb as non-previewable after decode failure.
   * @param index Image index that failed.
   */
  const handleThumbError = (index: number): void => {
    setBrokenIndexes((prev) => {
      if (prev.has(index)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  if (!hasText && !hasImages && missingImageCount === 0) {
    return null;
  }

  return (
    <div className="msg-user-wrap">
      {hasImages ? (
        <ul className="msg-user-attachments" aria-label="Attached images">
          {images.map((img, index) => {
            const att = toAttachment(img, index + 1);
            const previewSrc = attachmentPreviewSrc(att);
            const showThumb = canShowThumb(img, index);
            const label = att.name ?? "image";
            const openLabel = showThumb
              ? `Preview ${label}`
              : `Open ${label} with system viewer`;
            const key = `${img.mimeType}:${img.data.slice(0, 32)}:${index}`;
            return (
              <li key={key} className="msg-user-attachment">
                <button
                  type="button"
                  className="msg-user-attachment-open"
                  aria-label={openLabel}
                  title={
                    showThumb
                      ? `${label} — click to preview`
                      : `${label} — click to open with system viewer`
                  }
                  onClick={() => handleOpenImage(img, index)}
                >
                  {showThumb && previewSrc ? (
                    <img
                      className="msg-user-attachment-thumb"
                      src={previewSrc}
                      alt={label}
                      onError={() => handleThumbError(index)}
                    />
                  ) : (
                    <span className="msg-user-attachment-fallback">
                      {label}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {missingImageCount > 0 ? (
        <ul className="msg-user-attachments" aria-label="Referenced images">
          {Array.from({ length: missingImageCount }, (_, index) => (
            <li key={`missing-img-${index}`} className="msg-user-attachment">
              <span
                className="msg-user-attachment-fallback"
                title="Image was not kept in history (agent echo placeholder)"
              >
                {`image ${index + 1}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {hasText ? (
        <div
          className="item-user"
          data-kind="user"
          data-find-hit={highlight ? "1" : undefined}
        >
          {/* Sent text uses the same accent spans as the composer mirror so
              history matches the draft (no icon pill). Placeholders stripped. */}
          <MentionTextView text={text} />
        </div>
      ) : null}
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
