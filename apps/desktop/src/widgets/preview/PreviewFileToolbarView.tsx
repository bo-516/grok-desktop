/**
 * Stateless preview head toolbar: optional rendered|source toggle + copy full text.
 * Mode controls only appear for document-kind files; copy always does.
 */

import cs from "classnames";
import { Copy } from "lucide-react";
import type { DocViewMode } from "@/lib/docViewPrefs";

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
  /** True while the copied flash is showing. */
  copied?: boolean;
};

/**
 * Mode toggle + copy cluster for the preview head actions slot.
 * @param props Mode visibility, current mode, and copy handlers.
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
        className="btn-ghost h-6 px-1.5"
        onClick={props.onCopy}
        aria-label="Copy full text"
        title={props.copied ? "Copied" : "Copy full text"}
      >
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
