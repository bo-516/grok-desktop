/**
 * Shared collapsible chrome for turn rail steps and the turn shell header.
 * Controlled: open / onToggle live in the Stateful parent (auto-collapse policy).
 * Pure presentation — no store, no local expand state.
 */

import cs from "classnames";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Visual variants: nested rail steps vs the turn rail header pill. */
export type CollapsibleStepVariant = "turn-step" | "shell-toggle";

export type CollapsibleStepViewProps = {
  /** Whether the body is expanded. */
  open: boolean;
  /** Toggle expand; parent owns state and auto-collapse policy. */
  onToggle: () => void;
  /** Header label (text or richer ReactNode). */
  label: ReactNode;
  /** Expanded body; omitted when closed or empty. */
  body?: ReactNode;
  /** "turn-step" for nested rows; "shell-toggle" for the turn rail header. */
  variant: CollapsibleStepVariant;
  /** Active / live emphasis (turn-step-active or shell-toggle-live). */
  active?: boolean;
  /**
   * When true and variant is shell-toggle, paints shell-toggle-done when not active.
   * Ignored for turn-step (done is the absence of active).
   */
  done?: boolean;
  /** Optional root class for the outer wrapper (e.g. item-thought). */
  className?: string;
  /** Optional data-kind / data-* on the outer wrapper. */
  dataKind?: string;
  /** Optional ARIA role on the outer wrapper (e.g. listitem for rail steps). */
  role?: string;
  /** Optional extra class on the toggle button. */
  buttonClassName?: string;
  /** Optional extra class on the label span (turn-step only). */
  labelClassName?: string;
  /**
   * When true, shell-toggle puts the label node directly (no span wrapper).
   * Turn-step always wraps label in turn-step-label unless label already is block.
   */
  bareLabel?: boolean;
};

/**
 * Controlled collapsible step: chevron + aria-expanded + optional body.
 * @param props open/onToggle required; missing body simply omits the panel.
 * @returns Wrapper with toggle button and optional expanded content.
 */
export function CollapsibleStepView(props: CollapsibleStepViewProps) {
  const {
    open,
    onToggle,
    label,
    body,
    variant,
    active = false,
    done = false,
    className,
    dataKind,
    role,
    buttonClassName,
    labelClassName,
    bareLabel = false,
  } = props;

  const toggleClassName = cs(
    {
      "turn-step": variant === "turn-step",
      "turn-step-active": variant === "turn-step" && active,
      "shell-toggle": variant === "shell-toggle",
      "shell-toggle-live": variant === "shell-toggle" && active,
      "shell-toggle-done": variant === "shell-toggle" && done && !active,
    },
    buttonClassName,
  );

  const chevron = open ? (
    <ChevronDown className="shell-chevron" strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronRight className="shell-chevron" strokeWidth={2} aria-hidden="true" />
  );

  const labelNode =
    bareLabel || variant === "shell-toggle" ? (
      label
    ) : (
      <span className={cs("turn-step-label", labelClassName)}>{label}</span>
    );

  return (
    <div className={className} data-kind={dataKind} role={role}>
      <button
        type="button"
        className={toggleClassName}
        aria-expanded={open}
        onClick={onToggle}
      >
        {chevron}
        {labelNode}
      </button>
      {open && body != null ? body : null}
    </div>
  );
}
