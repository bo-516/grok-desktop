/**
 * Stateless preview head toolbar: optional rendered|source toggle + copy full text.
 * Mode controls only appear for document-kind files; copy always does.
 * After a successful clipboard write the copy control flashes CopiedMarkView
 * (same check + "Copied" the path double-click parks under the pointer).
 */

import cs from "classnames";
import { Copy } from "lucide-react";
import type { DocViewMode } from "@/lib/docViewPrefs";
import {
  CopiedMarkView,
  PREVIEW_COPY_ICON_PX,
  PREVIEW_COPY_ICON_STROKE,
} from "./CopiedMarkView";

export type PreviewFileToolbarViewProps = {
  /**
   * When true, show the rendered/source segmented control.
   * Non-doc files only get the copy button so chrome does not jump in shape.
   */
  showModeToggle: boolean;
  /** Effective body mode currently displayed. */
  mode: DocViewMode;
  /**
   * User picked a mode. Caller persists prefs and updates local state.
   * Not called when the orchestrator is hard-forcing source (e.g. oversize).
   */
  onModeChange: (mode: DocViewMode) => void;
  /** When true, mode buttons are inert (hard force — oversize). */
  modeLocked?: boolean;
  /** Copy the raw file source (not rendered HTML). */
  onCopy: () => void;
  /**
   * True while the copied flash is showing.
   * Swaps the copy glyph for a check + "Copied" so a click is visible without
   * relying on the tooltip (tooltips do not update while the pointer is down).
   */
  copied?: boolean;
};

/**
 * Mode toggle + copy cluster for the preview head actions slot.
 * Copy stays icon-only until `copied`, then flashes check + label and reverts
 * when the caller clears the flag (typically ~1.2s via useCopyFeedback).
 * The copy control uses `preview-copy-btn` so rem padding cannot push
 * the lucide mark off the 24px face.
 * @param props Mode visibility, current mode, copy handler, and flash flag.
 */
export function PreviewFileToolbarView(props: PreviewFileToolbarViewProps) {
  return (
    <div className="preview-head-toolbar">
      {props.showModeToggle ? (
        <div
          className="preview-mode-toggle"
          role="group"
          aria-label="Document view mode"
        >
          <button
            type="button"
            className={cs("preview-mode-btn", {
              "preview-mode-btn-active": props.mode === "rendered",
            })}
            aria-pressed={props.mode === "rendered"}
            disabled={props.modeLocked}
            onClick={() => props.onModeChange("rendered")}
          >
            Rendered
          </button>
          <button
            type="button"
            className={cs("preview-mode-btn", {
              "preview-mode-btn-active": props.mode === "source",
            })}
            aria-pressed={props.mode === "source"}
            disabled={props.modeLocked}
            onClick={() => props.onModeChange("source")}
          >
            Source
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="preview-copy-btn"
        onClick={props.onCopy}
        aria-label={props.copied ? "Copied" : "Copy full text"}
        aria-live="polite"
        title={props.copied ? "Copied" : "Copy full text"}
      >
        {props.copied ? (
          <CopiedMarkView />
        ) : (
          <Copy
            size={PREVIEW_COPY_ICON_PX}
            strokeWidth={PREVIEW_COPY_ICON_STROKE}
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  );
}
