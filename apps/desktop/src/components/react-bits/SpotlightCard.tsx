/**
 * React Bits SpotlightCard — pointer-following soft spotlight.
 * Mouse position is React state → CSS vars (no imperative DOM writes).
 *
 * Purpose: tool cards, settings sections, dense interactive panels.
 */

import cs from "classnames";
import { useState, type ReactNode } from "react";

export type SpotlightCardProps = {
  children: ReactNode;
  className?: string;
};

/**
 * @param props children + optional className for layout
 * @returns Card shell with radial spotlight under the pointer
 */
export function SpotlightCard(props: SpotlightCardProps) {
  const { children, className } = props;
  const [pos, setPos] = useState({ x: "50%", y: "50%" });

  return (
    <div
      className={cs("rb-spotlight-card", className)}
      style={{
        ["--rb-mouse-x" as string]: pos.x,
        ["--rb-mouse-y" as string]: pos.y,
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({
          x: `${e.clientX - rect.left}px`,
          y: `${e.clientY - rect.top}px`,
        });
      }}
    >
      {children}
    </div>
  );
}
