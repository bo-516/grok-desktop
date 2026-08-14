/**
 * Viewport-fixed copy confirmation parked just below the pointer.
 * Portals to document.body so drawer translate / title overflow cannot clip
 * or remount the chip in local coordinates.
 */

import { createPortal } from "react-dom";
import { CopiedMarkView } from "./CopiedMarkView";

/** Viewport point captured from a double-click (clientX / clientY). */
export type CopyCursorPoint = {
  /** Viewport X of the pointer. */
  x: number;
  /** Viewport Y of the pointer. */
  y: number;
};

/**
 * Gap under the cursor so the chip sits below the pointer, not under it.
 * Kept small so the mark still reads as attached to the click.
 */
const COPY_FLASH_OFFSET_Y = 12;

export type CopiedCursorFlashViewProps = {
  /** Viewport X — chip is centered on this axis. */
  x: number;
  /** Viewport Y — chip top is this plus COPY_FLASH_OFFSET_Y. */
  y: number;
};

/**
 * Opaque chip face at the captured pointer. Own element so the portal
 * wrapper never holds a JSX identifier — code-inspector re-tags that
 * pattern and emits a duplicate `data-insp-path` on the same node.
 * @param props Raw client coordinates from the copy gesture.
 * @returns Status chip; `left` / `top` stay in React `style` (layout, not color).
 */
function CopiedCursorFlashChipView(props: CopiedCursorFlashViewProps) {
  return (
    <div
      className="preview-copy-flash"
      style={{ left: `${props.x}px`, top: `${props.y + COPY_FLASH_OFFSET_Y}px` }}
      role="status"
      aria-live="polite"
    >
      <CopiedMarkView />
    </div>
  );
}

/**
 * Floating check + "Copied" chip, same mark as the preview copy button.
 * Own opaque face (`preview-copy-flash` / bg-highest) — stacking the
 * transparent copy button chrome lets the path text show through.
 * `left` / `top` are layout (not color) and must stay in React `style` so
 * the chip can track an arbitrary pointer without a Uno class per pixel.
 * @param props Raw client coordinates from the copy gesture.
 * @returns Portal node when `document.body` exists; inline fallback for SSR
 *   / Node tests that have no document.
 */
export function CopiedCursorFlashView(props: CopiedCursorFlashViewProps) {
  if (typeof document === "undefined" || !document.body) {
    return <CopiedCursorFlashChipView x={props.x} y={props.y} />;
  }
  return createPortal(
    <CopiedCursorFlashChipView x={props.x} y={props.y} />,
    document.body,
  );
}
