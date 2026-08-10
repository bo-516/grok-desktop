/**
 * Token-mapped checkbox control (design-system substitute for native blue).
 * Keeps native input for keyboard + ARIA; visual box uses --color-* only.
 *
 * Purpose: Settings and forms that must match OKLCH brand chrome —
 * empty = faint surface + strong border; checked = primary fill + on-primary mark.
 * The box is deliberately square-ish (4px radius): at the panel's 16px size a
 * larger radius reads as a radio, i.e. as a mutually exclusive choice.
 * Boundary: controlled presentational; parent owns checked state.
 */

import cs from "classnames";
import { Check } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "className"
> & {
  /** Optional label text rendered beside the control. */
  label?: string;
  /**
   * Optional secondary line under the label (what the option actually does).
   * ReactNode so callers can mark up part of it (e.g. an env key in mono).
   * Omit it for self-explanatory toggles — an empty description still costs a
   * line box and re-crowds the row it was meant to clarify.
   */
  description?: ReactNode;
  /** Extra classes on the outer label wrapper. */
  className?: string;
};

/**
 * Accessible checkbox with tokenized chrome (peer-driven checked/hover states).
 * @param props Standard input props + optional label/description; onChange required for controlled use
 * @returns Label wrapping visually hidden native input + custom box
 */
export function Checkbox(props: CheckboxProps) {
  const { label, description, className, disabled, checked, id, ...rest } =
    props;
  const inputId = id;

  return (
    <label
      className={cs("ui-check relative", className, {
        "ui-check-disabled": Boolean(disabled),
      })}
      htmlFor={inputId}
    >
      <input
        {...rest}
        id={inputId}
        type="checkbox"
        className="ui-check-input"
        checked={checked}
        disabled={disabled}
      />
      <span className="ui-check-box" aria-hidden="true">
        {checked ? (
          <Check className="ui-check-mark" strokeWidth={3} aria-hidden />
        ) : null}
      </span>
      {label ? (
        <span className="ui-check-text">
          <span className="ui-check-label">{label}</span>
          {description ? (
            <span className="ui-check-desc">{description}</span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
