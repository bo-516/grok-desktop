/**
 * Shared right-drawer shell for Settings / Extensions / Overview / Tasks.
 *
 * Purpose: fixed elevated panel + dimmed backdrop so content is readable and
 * dismissible (Close, backdrop click, Escape). Optional sticky footer for Apply.
 * Parent owns open state.
 *
 * Boundary: pure presentation — no store. Missing onClose leaves the drawer stuck.
 */

import { useEffect, type ReactNode } from "react";
import cs from "classnames";

export type SidePanelShellProps = {
  /** When false, render nothing (no portal footprint). */
  open: boolean;
  /** Accessible name for the dialog region. */
  label: string;
  /** Header title text. */
  title: string;
  /** Dismiss handler — Close button, backdrop, Escape. */
  onClose: () => void;
  /** Scrollable body content. */
  children: ReactNode;
  /**
   * Optional sticky footer (e.g. Settings Apply). Always visible at the
   * bottom of the drawer regardless of body scroll.
   */
  footer?: ReactNode;
  /** When true, footer uses dirty/warning border treatment. */
  footerDirty?: boolean;
};

/**
 * Renders backdrop + fixed right panel when open.
 * @param props open/label/title/onClose/children — onClose required for dismiss paths
 * @returns null when closed; otherwise overlay shell
 */
export function SidePanelShell(props: SidePanelShellProps) {
  const { open, label, title, onClose, children, footer, footerDirty } = props;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="side-panel-backdrop"
        aria-label={`Close ${label}`}
        onClick={onClose}
      />
      {/* Fixed panel owns its own enter animation (animate-modal-in); do not wrap
          with transform/filter parents — that would break position:fixed. */}
      <aside
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="side-panel-head">
          <h2 className="side-panel-title">{title}</h2>
          <button
            type="button"
            className="side-panel-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="side-panel-body">{children}</div>
        {footer ? (
          <div
            className={cs("side-panel-footer", {
              "side-panel-footer-dirty": Boolean(footerDirty),
            })}
          >
            {footer}
          </div>
        ) : null}
      </aside>
    </>
  );
}
