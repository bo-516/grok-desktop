/**
 * Secondary confirm dialog for irreversible actions (J-05).
 * Presentation-only: parent owns open state and callbacks.
 * While open: focuses the cancel control, traps Tab, and dismisses via
 * Escape or backdrop click (both map to onCancel). Capture-phase Escape
 * stops immediate propagation so a parent side-panel Escape handler does
 * not also fire (e.g. Settings dirty close).
 */

import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import cs from "classnames";
import { FadeContent } from "@/components/react-bits";
import {
  focusInitialIn,
  restoreFocus,
  trapFocusTab,
} from "@/lib/focusTrap";

export type ConfirmDialogViewProps = {
  open: boolean;
  title: string;
  details: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for delete/clear. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Modal confirm surface; returns null when closed.
 * Hooks always run (open gated inside effects) so focus restore stays valid.
 * @param props Title/details from buildConfirmPrompt; handlers must not auto-fire on mount.
 */
export function ConfirmDialogView(props: ConfirmDialogViewProps) {
  const {
    open,
    title,
    details,
    confirmLabel,
    cancelLabel,
    danger,
    onConfirm,
    onCancel,
  } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  /** Element that held focus before this confirm opened. */
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Enter: remember prior focus and land on Cancel (first action).
  // Exit: restore prior focus when the node is still connected.
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

  // Capture-phase Escape → onCancel (wins over side-panel Escape).
  // Tab cycles inside the alertdialog panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
        return;
      }
      const panel = panelRef.current;
      if (panel) {
        trapFocusTab(e, panel);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  /**
   * Backdrop click dismisses; clicks on the panel itself must not bubble.
   * @param e Click on the dimmed overlay
   */
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) {
      return;
    }
    onCancel();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <FadeContent immediate durationMs={240}>
        <div
          ref={panelRef}
          className="modal-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="confirm-title" className="modal-title">
            {title}
          </h2>
          <ul className="modal-details">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={onCancel}
            >
              {cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={cs("btn-primary", {
                "btn-danger": danger !== false,
              })}
              onClick={onConfirm}
            >
              {confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </FadeContent>
    </div>
  );
}
