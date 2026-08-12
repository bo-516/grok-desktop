/**
 * Stateless document body for the preview drawer: scroll shell, reading width,
 * optional banners, and a Streamdown-ready content slot. No stores, no network.
 */

import type { ReactNode } from "react";
import cs from "classnames";

export type PreviewDocViewProps = {
  /**
   * Already-rendered Markdown tree (Streamdown + component map). Kept as a slot
   * so this view stays free of Streamdown / KaTeX / link handlers.
   */
  children: ReactNode;
  /** When true, show the bridge 1MB truncation banner. */
  truncated?: boolean;
  /**
   * When true, content exceeded {@link DOC_RENDER_MAX_CHARS} and the
   * orchestrator forced source — this view is not shown in that case; the
   * prop is reserved for a soft warning if a future path still renders.
   */
  sizeForcedSource?: boolean;
  /** Optional status banner text above the document (e.g. degrade reason). */
  banner?: string;
};

/**
 * Read-only rendered-document chrome: outer scroll + centered max-width root.
 * @param props Banners plus the Markdown tree as children.
 */
export function PreviewDocView(props: PreviewDocViewProps) {
  const banner =
    props.banner ??
    (props.truncated
      ? "File truncated for preview (first 1MB shown)."
      : undefined);
  return (
    <div className="flex flex-col flex-1 min-h-0" data-kind="preview-doc">
      {banner ? (
        <div
          className={cs("preview-banner", {
            "preview-banner-warn": Boolean(props.sizeForcedSource),
          })}
          role="status"
        >
          {banner}
        </div>
      ) : null}
      {/* tabIndex so PageUp/PageDown reach the scroll region without a mouse. */}
      <div className="doc-scroll" tabIndex={0}>
        <div className="doc-root">{props.children}</div>
      </div>
    </div>
  );
}
