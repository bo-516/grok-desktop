/**
 * Token-mapped checkbox control (design-system substitute for native blue).
 * Keeps native input for keyboard + ARIA; visual box uses --color-* only.
 *
 * Purpose: Settings and forms that must match OKLCH brand chrome —
 * empty = faint surface + strong border; checked = primary fill + on-primary mark.
 * Boundary: controlled presentational; parent owns checked state.
 */

import cs from "classnames";
import type { InputHTMLAttributes } from "react";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "className"
> & {
  /** Optional label text rendered beside the control. */
  label?: string;
  /** Extra classes on the outer label wrapper. */
  className?: string;
};

/**
 * Accessible checkbox with tokenized chrome (peer-driven checked/hover states).
 * @param props Standard input props + optional label; onChange required for controlled use
 * @returns Label wrapping visually hidden native input + custom box
 */
export function Checkbox(props: CheckboxProps) {
  const { label, className, disabled, checked, id, ...rest } = props;
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
        {checked ? <span className="ui-check-mark" /> : null}
      </span>
      {label ? <span className="ui-check-label">{label}</span> : null}
    </label>
  );
}
