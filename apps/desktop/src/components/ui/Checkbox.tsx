/**
 * Token-mapped checkbox control (design-system substitute for native blue).
 * Keeps native input for keyboard + ARIA; visual box uses --color-* only.
 *
 * Purpose: Settings and forms that must match OKLCH brand chrome —
 * empty = high surface + muted border; checked = primary fill + on-primary mark.
 * The box stays square-ish (3.5px radius): at ~15px a larger radius reads as a
 * radio, i.e. as a mutually exclusive choice.
 *
 * Checked chrome is class-driven (`ui-check-box-on` / `ui-check-mark-on`) from
 * the controlled `checked` prop — not `peer-checked`. Uno shortcuts inline
 * utilities into one rule, so a `peer` token inside a shortcut never becomes a
 * real `.peer` class on the DOM and peer variants never match.
 *
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
 * Accessible checkbox with tokenized chrome (class-driven checked + focus-within ring).
 * @param props Standard input props + optional label/description; onChange required for controlled use
 * @returns Label wrapping visually hidden native input + custom box
 */
export function Checkbox(props: CheckboxProps) {
  const { label, description, className, disabled, checked, id, ...rest } =
    props;
  const inputId = id;
  /** Controlled on/off — drives box fill and mark visibility (not CSS :checked). */
  const isOn = Boolean(checked);

  return (
    <label
      className={cs(
        /* Literal `group`: Uno shortcuts do not emit a real .group class. */
        "group ui-check",
        className,
        {
          "ui-check-disabled": Boolean(disabled),
        },
      )}
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
      <span
        className={cs("ui-check-box", { "ui-check-box-on": isOn })}
        aria-hidden="true"
      >
        {/*
         * Always mounted so scale/opacity can animate; hidden when off.
         * size 11 + stroke 2.5 keeps the glyph crisp inside a 15px face.
         */}
        <Check
          className={cs("ui-check-mark", { "ui-check-mark-on": isOn })}
          size={11}
          strokeWidth={2.5}
          aria-hidden
        />
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
