/**
 * Stateless Composer mode control: trigger chip + radiogroup popover + pending.
 * Parent owns open state, mode, pendingMode, and select/cycle handlers.
 * Missing onSelect leaves mode stuck; missing onClose leaves the popover open.
 */

import cs from "classnames";
import { useEffect, useRef } from "react";
import type { AgentMode } from "@grok-desktop/acp-core";
import { modeLabel, type AgentModeOption } from "./composerModes";

export type ComposerModeControlViewProps = {
  /** Confirmed session mode (not the in-flight target). */
  mode: AgentMode | string;
  /** Non-null while a mode switch is in flight — shows Switching… + aria-busy. */
  pendingMode: AgentMode | null;
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
 * @param props Mode state and handlers; pendingMode drives busy chrome.
 * @returns Composer mode control fragment.
 */
export function ComposerModeControlView(props: ComposerModeControlViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { open, onClose, pendingMode, mode } = props;
  const pending = pendingMode !== null;
  const displayMode: AgentMode | string = pendingMode ?? mode;
  const label = pending
    ? `Switching to ${modeLabel(pendingMode)}…`
    : modeLabel(mode);

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
          "composer-mode-trigger-pending": pending,
          "composer-mode-build": !pending && displayMode === "build",
          "composer-mode-plan": !pending && displayMode === "plan",
          "composer-mode-ask": !pending && displayMode === "ask",
        })}
        title="Agent mode — click to choose · ⇧Tab to cycle"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        aria-busy={pending}
        disabled={pending}
        onClick={props.onToggle}
      >
        <span className="composer-mode-label">{label}</span>
        {!pending ? (
          <span className="composer-mode-chevron" aria-hidden="true">
            ▾
          </span>
        ) : (
          <span className="composer-mode-spinner" aria-hidden="true">
            …
          </span>
        )}
      </button>
      {props.open && !pending ? (
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
