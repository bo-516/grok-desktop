/**
 * Shared collapsible chrome for turn rail steps and the turn shell header.
 * Controlled: open / onToggle live in the Stateful parent (auto-collapse policy).
 * No store / no local expand state. One layout side-effect: after a user-driven
 * closed→open edge, scrolls this unit into the nearest scrollport so expanded
 * thought / Worked bodies are not left below the fold (see useLayoutEffect).
 *
 * Layout differs by variant:
 * - turn-step: chevron left of label (nested rail rows)
 * - shell-toggle: label left-aligned, chevron on the right, full-width rule
 *   under the header (Codex-style “Worked for …” rail header)
 */

import cs from "classnames";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

/** Visual variants: nested rail steps vs the turn rail header (Codex-style). */
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
   * When true, turn-step puts the label node directly (no turn-step-label span).
   * Shell-toggle always wraps label in shell-toggle-label for flex alignment.
   */
  bareLabel?: boolean;
};

/**
 * Controlled collapsible step: chevron + aria-expanded + optional body.
 * Shell-toggle places the chevron after the label and draws a rule under the
 * header; turn-step keeps chevron-before-label geometry for nested rail rows.
 * On closed→open (user expand), scrolls the root into the nearest overflow
 * ancestor so the new body is visible inside the timeline and/or turn-rail.
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

  /** Outer unit (header + body) — target for expand scroll-into-view. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * Previous `open` so we only scroll on a closed→open edge.
   * Seeded with the current open so default-open mounts (live Worked rail,
   * Thought remount open) never auto-scroll and fight stick-to-bottom.
   */
  const prevOpenRef = useRef(open);

  /** True when rendering the turn rail header (label left, chevron right + rule). */
  const isShell = variant === "shell-toggle";

  const toggleClassName = cs(
    {
      "turn-step": variant === "turn-step",
      "turn-step-active": variant === "turn-step" && active,
      "shell-toggle": isShell,
      "shell-toggle-live": isShell && active,
      "shell-toggle-done": isShell && done && !active,
    },
    buttonClassName,
  );

  const chevron = open ? (
    <ChevronDown className="shell-chevron" strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronRight className="shell-chevron" strokeWidth={2} aria-hidden="true" />
  );

  /** Label node: shell always wraps for flex; turn-step wraps unless bareLabel. */
  const labelNode = isShell ? (
    <span className={cs("shell-toggle-label", labelClassName)}>{label}</span>
  ) : bareLabel ? (
    label
  ) : (
    <span className={cs("turn-step-label", labelClassName)}>{label}</span>
  );

  /**
   * After the expanded body is in the DOM, bring this unit into the nearest
   * scrollport (timeline and/or capped turn-rail). block/inline nearest keeps
   * fully-visible units still; smooth is user-gesture expand only.
   */
  useLayoutEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) {
      return;
    }
    const el = rootRef.current;
    if (!el || typeof el.scrollIntoView !== "function") {
      return;
    }
    el.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [open]);

  const toggleButton = (
    <button
      type="button"
      className={toggleClassName}
      aria-expanded={open}
      onClick={onToggle}
    >
      {isShell ? (
        <>
          {labelNode}
          {chevron}
        </>
      ) : (
        <>
          {chevron}
          {labelNode}
        </>
      )}
    </button>
  );

  return (
    <div ref={rootRef} className={className} data-kind={dataKind} role={role}>
      {isShell ? (
        /* Keep label + rule as one unit so parent gap only separates header from body. */
        <div className="shell-toggle-head">
          {toggleButton}
          <div className="shell-toggle-rule" aria-hidden="true" />
        </div>
      ) : (
        toggleButton
      )}
      {open && body != null ? body : null}
    </div>
  );
}
