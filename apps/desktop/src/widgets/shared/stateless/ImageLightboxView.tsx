/**
 * Full-viewport image preview overlay (composer attach + timeline history).
 * Pure presentation: parent owns open/close and Escape; click backdrop to dismiss.
 */

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
 * Fixed dimmed stage with a contained image and a corner close control.
 * @param props Non-empty src required; parent should unmount when closed.
 * @returns Dialog markup; never returns null (caller gates mount).
 */
export function ImageLightboxView(props: ImageLightboxViewProps) {
  const { src, alt, onClose } = props;
  return (
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
}
