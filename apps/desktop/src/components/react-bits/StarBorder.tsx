/**
 * React Bits StarBorder — animated dual-edge highlight around a control.
 * Colors come from CSS tokens (see base.css `.rb-star-border*`).
 *
 * Purpose: primary actions (send, apply) with a subtle “alive” edge.
 */

import cs from "classnames";
import type { ElementType, ReactNode } from "react";

export type StarBorderProps = {
  children: ReactNode;
  className?: string;
  /** Wrapper element type (button | div | span). */
  as?: ElementType;
  /** Animation duration CSS value, e.g. `5s`. */
  speed?: string;
  /** Disabled styling (no animation). */
  disabled?: boolean;
  /** Passthrough click when as=button. */
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  title?: string;
};

/**
 * @param props children required; disabled freezes border motion
 * @returns Polymorphic bordered wrapper
 */
export function StarBorder(props: StarBorderProps) {
  const {
    children,
    className,
    as,
    speed = "5s",
    disabled = false,
    onClick,
    type = "button",
    title,
  } = props;
  const Component = (as ?? "button") as ElementType;
  const isButton = Component === "button";

  return (
    <Component
      className={cs("rb-star-border", className, {
        "rb-star-border-disabled": disabled,
      })}
      style={{ ["--rb-star-speed" as string]: speed }}
      onClick={onClick}
      title={title}
      {...(isButton ? { type, disabled } : {})}
    >
      <span className="rb-star-border-glow rb-star-border-glow-bottom" aria-hidden />
      <span className="rb-star-border-glow rb-star-border-glow-top" aria-hidden />
      <span className="rb-star-border-inner">{children}</span>
    </Component>
  );
}
