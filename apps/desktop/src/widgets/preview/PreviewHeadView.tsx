/**
 * Stateless preview drawer chrome: path, +N/−M summary, optional actions slot, close.
 * A path title renders as dir + file name (workspace-shortened by the caller)
 * and wraps in the head so a long file name is never clipped by the toolbar.
 * The absolute path stays in the tooltip and on the copy gesture.
 * Double-click confirmation is a cursor chip (CopiedMarkView), not inline text.
 */

import { X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { PathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";
import {
  CopiedCursorFlashView,
  type CopyCursorPoint,
} from "./CopiedCursorFlashView";

export type PreviewHeadViewProps = {
  /** Primary title (path or "Changes"); also the fallback when display is absent. */
  title: string;
  /** Shortened parts when the title is a file path; absent for "Changes"/placeholders. */
  display?: PathDisplay;
  /** True while the path-copy flash is showing (after a successful write). */
  copied?: boolean;
  /**
   * Viewport point of the double-click that requested the copy.
   * Required to park the check + "Copied" chip under the pointer; ignored
   * when `copied` is false.
   */
  copyAt?: CopyCursorPoint | null;
  /**
   * Copy the absolute path. Receives the double-click viewport point so the
   * caller can hold it until the clipboard write resolves.
   */
  onCopyPath?: (point: CopyCursorPoint) => void;
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
          copyAt={props.copyAt}
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
          <X
            className="block shrink-0"
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

/**
 * Title line: split wrapping path label when the target is a file, plain
 * wrapping text otherwise. Double-click copies; confirmation is a cursor
 * chip (same mark as the file-text copy button), not an inline "Copied"
 * flag that a multi-line title would clip.
 * @param props Raw title plus optional path display, flash point, and copy.
 * @returns h2 heading plus the floating flash when a copy just succeeded.
 */
function PreviewTitleView(props: {
  title: string;
  display?: PathDisplay;
  copied?: boolean;
  copyAt?: CopyCursorPoint | null;
  onCopyPath?: (point: CopyCursorPoint) => void;
}) {
  const { title, display, copied, copyAt, onCopyPath } = props;
  /**
   * Forward the pointer so the flash can sit under the cursor, not in the title.
   * @param event Heading double-click; only clientX/clientY are used.
   */
  const handleDoubleClick = (event: MouseEvent<HTMLHeadingElement>) => {
    onCopyPath?.({ x: event.clientX, y: event.clientY });
  };
  if (!display) {
    return (
      <h2 className="preview-title" title={title}>
        {title}
      </h2>
    );
  }

  return (
    <>
      <h2
        className="preview-title preview-title-row"
        title={`${display.full}\nDouble-click to copy path`}
        data-path={display.full}
        onDoubleClick={handleDoubleClick}
      >
        <PathLabelView display={display} wrap />
      </h2>
      {copied && copyAt ? (
        <CopiedCursorFlashView x={copyAt.x} y={copyAt.y} />
      ) : null}
    </>
  );
}
