/**
 * React Bits GlareHover — diagonal light sweep on hover.
 * Token-driven via CSS vars set on the host class (no color literals in TSX).
 *
 * Purpose: session rows, tool cards, menu tiles.
 */

import cs from "classnames";
import type { ReactNode } from "react";

export type GlareHoverProps = {
  children: ReactNode;
  className?: string;
  /** Play the glare only once per hover session. */
  playOnce?: boolean;
};

/**
 * @param props children wrapped for glare overlay; empty children still paint shell
 * @returns Relative container with ::before glare from CSS
 */
export function GlareHover(props: GlareHoverProps) {
  const { children, className, playOnce = false } = props;
  return (
    <div
      className={cs("rb-glare-hover", className, {
        "rb-glare-hover-once": playOnce,
      })}
    >
      {children}
    </div>
  );
}
