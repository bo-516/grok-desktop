/**
 * Secondary confirm dialog for irreversible actions (J-05).
 * Stateless: parent owns open state and callbacks.
 */

import cs from "classnames";
import { FadeContent } from "@/components/react-bits";

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
 * @param props Title/details from buildConfirmPrompt; handlers must not auto-fire on mount.
 */
export function ConfirmDialogView(props: ConfirmDialogViewProps) {
  if (!props.open) {
    return null;
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <FadeContent immediate durationMs={240}>
        <div
          className="modal-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          <h2 id="confirm-title" className="modal-title">
            {props.title}
          </h2>
          <ul className="modal-details">
            {props.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={cs("btn-primary", {
                "btn-danger": props.danger !== false,
              })}
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </FadeContent>
    </div>
  );
}
