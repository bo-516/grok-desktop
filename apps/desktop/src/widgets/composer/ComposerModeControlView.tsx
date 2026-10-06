/**
 * Stateless Composer mode control: trigger chip + radiogroup popover.
 * Parent owns open state, the painted mode, and select/cycle handlers.
 * The chip shows the mode the user picked immediately. Waiting for
 * grok-build's session/set_mode does not disable the chip or show a spinner.
 * Missing onSelect leaves mode stuck; missing onClose leaves the popover open.
 */

import cs from "classnames";
import { useEffect, useRef } from "react";
import type { AgentMode } from "@grok-desktop/acp-core";
import { modeLabel, type AgentModeOption } from "./composerModes";

export type ComposerModeControlViewProps = {
  /** Painted session mode (already updated when the user picks). */
  mode: AgentMode | string;
  /** Catalog of modes with descriptions. */
  options: readonly AgentModeOption[];
  /** Whether the popover is open. */
  open: boolean;
  /** Narrow layout: shorter trigger text. */
  compact?: boolean;
  /** Toggle popover from the trigger. */
  onToggle: () => void;
  /** Select a mode (closes after). */
  onSelect: (mode: AgentMode) => void;
  /** Close without selecting. */
  onClose: () => void;
};

/**
 * Renders mode trigger + exclusive select list with side-effect copy.
 * @param props Mode state and handlers.
 * @returns Composer mode control fragment.
 */
export function ComposerModeControlView(props: ComposerModeControlViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { open, onClose, mode } = props;
  const label = modeLabel(mode);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="composer-mode" ref={rootRef}>
      <button
        type="button"
        className={cs("composer-mode-trigger", {
          "composer-mode-build": mode === "build",
          "composer-mode-plan": mode === "plan",
          "composer-mode-ask": mode === "ask",
        })}
        title="Agent mode — click to choose · ⇧Tab to cycle"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span className="composer-mode-label">{label}</span>
        <span className="composer-mode-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {props.open ? (
        <div
          className="composer-mode-menu"
          role="radiogroup"
          aria-label="Agent mode"
        >
          {props.options.map((opt) => {
            const checked = opt.id === props.mode;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className={cs("composer-mode-option", {
                  "composer-mode-option-active": checked,
                })}
                onClick={() => props.onSelect(opt.id)}
              >
                <span className="composer-mode-option-check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <span className="composer-mode-option-text">
                  <span className="composer-mode-option-label">
                    {opt.label}
                  </span>
                  <span className="composer-mode-option-desc">
                    {opt.description}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="composer-mode-hint">⇧Tab cycles modes</p>
        </div>
      ) : null}
    </div>
  );
}
