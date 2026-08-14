/**
 * Shared check + "Copied" mark for preview copy flashes.
 * Used in-place on the file-text copy button and as the cursor chip after
 * a path double-click, so both gestures paint the same confirmation.
 */

import { Check } from "lucide-react";

/** Lucide mark size shared with the drawer close X / idle copy glyph. */
export const PREVIEW_COPY_ICON_PX = 16;
/** Stroke that matches the drawer close X. */
export const PREVIEW_COPY_ICON_STROKE = 1.75;

/**
 * Check glyph plus the "Copied" label.
 * Callers own chrome (button vs floating chip); this view is the mark only.
 * @returns Inline check + label; no wrapper of its own so the parent face
 *   can stay a single flex row.
 */
export function CopiedMarkView() {
  return (
    <>
      <Check
        size={PREVIEW_COPY_ICON_PX}
        strokeWidth={PREVIEW_COPY_ICON_STROKE}
        aria-hidden="true"
      />
      <span>Copied</span>
    </>
  );
}
