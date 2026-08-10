/**
 * Token-mapped select control (native select + design-token chrome).
 * Purpose: Settings dropdowns that match OKLCH surfaces instead of system blue.
 *
 * `appearance-none` removes the OS blue arrow along with the whole affordance,
 * so the wrapper redraws one from the icon set; without it the field is
 * indistinguishable from a read-only text box. The chevron is pointer-events
 * transparent — clicks must still reach the native select and open its popup.
 *
 * Boundary: controlled presentational; parent owns value/onChange.
 */

import cs from "classnames";
import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes, ReactNode } from "react";

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className"
> & {
  /** Option children. */
  children: ReactNode;
  /** Extra classes on the select element. */
  className?: string;
};

/**
 * Styled native select (keyboard + screen-reader parity preserved).
 * @param props Standard select props; children must be option elements
 * @returns Select with ui-select classes, wrapped with a drawn chevron
 */
export function Select(props: SelectProps) {
  const { className, children, disabled, ...rest } = props;
  return (
    <span className="ui-select-wrap">
      <select
        {...rest}
        disabled={disabled}
        className={cs("ui-select", className, {
          "ui-select-disabled": Boolean(disabled),
        })}
      >
        {children}
      </select>
      <ChevronDown className="ui-select-chevron" aria-hidden focusable={false} />
    </span>
  );
}
