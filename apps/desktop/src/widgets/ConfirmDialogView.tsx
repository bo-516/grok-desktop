/**
 * Secondary confirm dialog for irreversible actions (J-05).
 * Presentation-only: parent owns open state and callbacks.
 * While open: focuses the cancel control, traps Tab, and dismisses via
 * Escape or backdrop click (both map to onCancel). Capture-phase Escape
 * stops immediate propagation so a parent side-panel Escape handler does
 * not also fire (e.g. Settings dirty close).
 */

import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent } from "react";
import cs from "classnames";
import { TriangleAlert } from "lucide-react";
import { FadeContent } from "@/components/react-bits";
import { formatConfirmSubject } from "@/lib/confirmAction";
import {
  focusInitialIn,
  restoreFocus,
  trapFocusTab,
} from "@/lib/focusTrap";

export type ConfirmDialogViewProps = {
  /** When false the view returns null; focus restore still runs on the close edge. */
  open: boolean;
  /** Short question shown next to the warning icon. */
  title: string;
  /**
   * Named target (session title, path). Rendered as a truncated chip so a
   * long label cannot wrap the heading. Optional.
   */
  subject?: string;
  /** Consequence copy; each string is one paragraph. */
  details: string[];
  /** Confirm control label; defaults to "Confirm". */
  confirmLabel?: string;
  /** Dismiss control label; defaults to "Cancel". */
  cancelLabel?: string;
  /** Destructive styling for delete/clear. */
  danger?: boolean;
  /** Fired only from the confirm control — never on mount. */
  onConfirm: () => void;
  /** Fired from Cancel, Escape, or backdrop click. */
  onCancel: () => void;
};

/**
 * Modal confirm surface; returns null when closed.
 * Hooks always run (open gated inside effects) so focus restore stays valid.
 * Renders a short title, optional subject chip, and paragraph details —
 * the long target name must not live in the heading.
 * @param props Title/details from buildConfirmPrompt; handlers must not auto-fire on mount.
 */
export function ConfirmDialogView(props: ConfirmDialogViewProps) {
  const {
    open,
    title,
    subject,
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
  /** Stable ids so stacked confirms (settings + shell) do not collide. */
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const subjectId = `${reactId}-subject`;
  const descId = `${reactId}-desc`;
  /** True unless the caller opts out — this surface is for irreversible ops. */
  const isDanger = danger !== false;
  /** Display-ready target; empty hides the chip. */
  const subjectText = formatConfirmSubject(subject);
  /** Space-joined ids for aria-describedby (subject chip + detail copy). */
  const describedBy = [subjectText ? subjectId : "", details.length > 0 ? descId : ""]
    .filter(Boolean)
    .join(" ");

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
          aria-labelledby={titleId}
          aria-describedby={describedBy || undefined}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="confirm-head">
            <div
              className={cs("confirm-icon", {
                "confirm-icon-danger": isDanger,
                "confirm-icon-default": !isDanger,
              })}
              aria-hidden="true"
            >
              <TriangleAlert className="confirm-icon-svg" strokeWidth={2} />
            </div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
          </div>
          {subjectText ? (
            <p id={subjectId} className="confirm-subject" title={subjectText}>
              {subjectText}
            </p>
          ) : null}
          {details.length > 0 ? (
            <div id={descId} className="confirm-details">
              {details.map((d) => (
                <p key={d} className="confirm-detail">
                  {d}
                </p>
              ))}
            </div>
          ) : null}
          <div className="confirm-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={onCancel}
            >
              {cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={cs("btn", {
                "btn-danger": isDanger,
                "btn-primary": !isDanger,
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
