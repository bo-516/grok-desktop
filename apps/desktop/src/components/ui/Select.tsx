/**
 * Token-mapped select control (native select + design-token chrome).
 * Purpose: Settings dropdowns that match OKLCH surfaces instead of system blue.
 * Boundary: controlled presentational; parent owns value/onChange.
 */

import cs from "classnames";
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
 * @returns Select with ui-select classes
 */
export function Select(props: SelectProps) {
  const { className, children, disabled, ...rest } = props;
  return (
    <select
      {...rest}
      disabled={disabled}
      className={cs("ui-select", className, {
        "ui-select-disabled": Boolean(disabled),
      })}
    >
      {children}
    </select>
  );
}
