/**
 * Shared right-drawer shell for Settings / Extensions / Overview / Tasks.
 *
 * Purpose: fixed elevated panel + dimmed backdrop so content is readable and
 * dismissible (Close, backdrop click, Escape). Optional sticky footer for Apply.
 * On open: moves focus into the dialog and traps Tab; on close: restores prior
 * focus. Parent owns open state.
 *
 * Boundary: pure presentation — no store. Missing onClose leaves the drawer stuck.
 * Escape is skipped while a stacked alertdialog (e.g. dirty confirm) is open so
 * that dialog owns dismiss first.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import cs from "classnames";
import {
  focusInitialIn,
  restoreFocus,
  trapFocusTab,
} from "@/lib/focusTrap";

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
  const panelRef = useRef<HTMLElement>(null);
  /** Element that held focus before this drawer opened (restored on close). */
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /** Stable id for aria-labelledby → visible title. */
  const titleId = useId();

  // Move focus in on open (layout phase — ref is attached); restore prior focus on close.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    focusInitialIn(panelRef.current);
    return () => {
      restoreFocus(previousFocusRef.current);
      previousFocusRef.current = null;
    };
  }, [open]);

  // Escape dismisses; Tab cycles inside the panel. Skip Escape under alertdialog.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stacked confirm (role=alertdialog) owns Escape first — do not double-fire onClose.
        if (document.querySelector('[role="alertdialog"][aria-modal="true"]')) {
          return;
        }
        e.preventDefault();
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (panel) {
        trapFocusTab(e, panel);
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
        tabIndex={-1}
        onClick={onClose}
      />
      {/* Fixed panel owns its own enter animation (animate-modal-in); do not wrap
          with transform/filter parents — that would break position:fixed. */}
      <aside
        ref={panelRef}
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="side-panel-head">
          <h2 id={titleId} className="side-panel-title">
            {title}
          </h2>
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
