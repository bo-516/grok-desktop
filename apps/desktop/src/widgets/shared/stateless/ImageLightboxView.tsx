/**
 * Full-page image preview dialog (composer attach + timeline history).
 * Pure presentation: parent owns open/close and Escape; click backdrop to
 * dismiss. Portals to document.body so overflow ancestors cannot clip the
 * stage, and applies a light backdrop blur over the dimmed page.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ImageLightboxViewProps = {
  /** data: or blob: URL for the full-size image. */
  src: string;
  /** Accessible label / alt text. */
  alt: string;
  /** Close on backdrop, close button, or parent Escape handler. */
  onClose: () => void;
};

/**
 * Fixed full-viewport dialog with a contained, centered image and a corner
 * close control. Backdrop is dimmed + lightly blurred so the page remains
 * faintly visible underneath.
 * @param props Non-empty src required; parent should unmount when closed.
 * @returns Portal dialog markup; never returns null (caller gates mount).
 */
export function ImageLightboxView(props: ImageLightboxViewProps) {
  const { src, alt, onClose } = props;

  // Lock page scroll while the full-page stage is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const dialog = (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${alt}`}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        aria-label="Close preview"
        title="Close"
        onClick={onClose}
      >
        <X className="image-lightbox-close-icon" aria-hidden="true" />
      </button>
      <img
        className="image-lightbox-img"
        src={src}
        alt={alt}
        // Stop backdrop close when interacting with the image itself.
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );

  return createPortal(dialog, document.body);
}
