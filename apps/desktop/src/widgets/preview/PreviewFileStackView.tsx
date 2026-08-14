/**
 * File-preview body wrapper: keeps the last file mounted and paints a light
 * blur veil while a later disk read is in flight (click-to-refresh).
 */

import cs from "classnames";
import type { ReactNode } from "react";

export type PreviewFileStackViewProps = {
  /**
   * True while `usePreviewSource` is re-reading disk. The previous file stays
   * as `children`; the veil only frosts that paint. False leaves the veil
   * mounted at opacity 0 so show/hide can fade.
   */
  refreshing: boolean;
  /** Painted file body (PreviewFileWidget). Must stay mounted across refresh. */
  children: ReactNode;
};

/**
 * Stack the file body under an inert frost veil.
 * @param props Refreshing flag and the file widget to keep painted.
 */
export function PreviewFileStackView(props: PreviewFileStackViewProps) {
  const { refreshing, children } = props;
  return (
    <div
      className="preview-file-stack"
      aria-busy={refreshing || undefined}
      data-preview-refreshing={refreshing ? "true" : undefined}
    >
      <div
        className={cs("preview-file-stack-body", {
          "preview-file-stack-body-refreshing": refreshing,
        })}
      >
        {children}
      </div>
      <div
        className={cs("preview-refresh-veil", {
          "preview-refresh-veil-on": refreshing,
        })}
        aria-hidden="true"
      />
    </div>
  );
}
