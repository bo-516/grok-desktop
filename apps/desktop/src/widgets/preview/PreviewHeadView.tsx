/**
 * Stateless preview drawer chrome: path, +N/−M summary, optional actions slot, close.
 * A path title renders as dir + file name (workspace-shortened by the caller);
 * the absolute path stays in the tooltip and on the copy gesture.
 */

import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { PathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

export type PreviewHeadViewProps = {
  /** Primary title (path or "Changes"); also the fallback when display is absent. */
  title: string;
  /** Shortened parts when the title is a file path; absent for "Changes"/placeholders. */
  display?: PathDisplay;
  /** True while the copied flash is showing. */
  copied?: boolean;
  /** Copy the absolute path (double-click on the title). */
  onCopyPath?: () => void;
  /** Optional secondary line (scope / status). */
  subtitle?: string;
  /** Aggregate +N when showing a diff. */
  added?: number;
  /** Aggregate −M when showing a diff. */
  removed?: number;
  /**
   * Extra head controls left of close (e.g. doc mode toggle + copy full text).
   * Absent for non-file targets so chrome stays compact.
   */
  actions?: ReactNode;
  /** Close the preview rail. */
  onClose: () => void;
};

/**
 * Preview drawer head bar.
 * @param props Title (plain or split path), optional counts/actions, close handler.
 */
export function PreviewHeadView(props: PreviewHeadViewProps) {
  const hasCounts =
    typeof props.added === "number" && typeof props.removed === "number";
  return (
    <div className="preview-head">
      <div className="preview-head-text">
        <PreviewTitleView
          title={props.title}
          display={props.display}
          copied={props.copied}
          onCopyPath={props.onCopyPath}
        />
        {props.subtitle ? (
          <p className="preview-subtitle">{props.subtitle}</p>
        ) : null}
        {hasCounts ? (
          <p className="preview-counts" aria-label="diff summary">
            <span className="preview-count-add">+{props.added}</span>
            <span className="preview-count-del">−{props.removed}</span>
          </p>
        ) : null}
      </div>
      <div className="preview-head-actions">
        {props.actions ?? null}
        <button
          type="button"
          className="context-drawer-close"
          onClick={props.onClose}
          aria-label="Close preview"
          title="Close"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Title line: split path label when the target is a file, plain text otherwise.
 * @param props Raw title plus optional path display and copy gesture.
 * @returns h2 heading; the accessible name is the shortened label, and the
 *   absolute path is reachable through the tooltip and the copy action.
 */
function PreviewTitleView(props: {
  title: string;
  display?: PathDisplay;
  copied?: boolean;
  onCopyPath?: () => void;
}) {
  const { title, display, copied, onCopyPath } = props;
  if (!display) {
    return (
      <h2 className="preview-title" title={title}>
        {title}
      </h2>
    );
  }
  return (
    <h2
      className="preview-title preview-title-row"
      title={`${display.full}\nDouble-click to copy path`}
      data-path={display.full}
      onDoubleClick={onCopyPath}
    >
      <PathLabelView display={display} />
      {copied ? <span className="path-copied-flag">Copied</span> : null}
    </h2>
  );
}
