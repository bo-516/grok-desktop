/**
 * Stateless stand-in for the preview drawer while its chunk loads.
 *
 * Purpose: the preview drawer can push the main column (push layout reserves
 * its width). If it is opened before idle warm-up finished, this paints the
 * same open drawer frame — same width, layout classes and the existing
 * `preview-empty` "Loading…" body — so the column never shows an empty gap
 * and nothing jumps when the real drawer replaces it.
 *
 * Boundary: no store, no handlers; it is only on screen for the few frames a
 * local chunk takes to load, so it carries no close affordance.
 */

import cs from "classnames";

export type PreviewDrawerPlaceholderViewProps = {
  /** Committed preview width in px (previewStore), matching the real drawer. */
  width: number;
  /** Overlay layout adds the drawer shadow; push layout stays flush. */
  overlay: boolean;
};

/**
 * Open-state preview drawer frame with a loading body.
 * @param props Width + overlay flag mirrored from the real drawer's inputs.
 * @returns A static `aside` styled like the open preview drawer.
 */
export function PreviewDrawerPlaceholderView(
  props: PreviewDrawerPlaceholderViewProps,
) {
  const { width, overlay } = props;
  return (
    <aside
      className={cs("context-drawer context-drawer-open", {
        "context-drawer-overlay": overlay,
      })}
      style={{ width: `${width}px`, maxWidth: "100%" }}
      aria-label="Preview"
      aria-busy="true"
    >
      <div className="context-drawer-body preview-body">
        <div className="preview-empty">Loading…</div>
      </div>
    </aside>
  );
}
