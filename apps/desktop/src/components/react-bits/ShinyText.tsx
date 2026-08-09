/**
 * React Bits ShinyText — gradient shimmer on muted copy.
 * Pure CSS animation; colors via defineColor tokens (no hex in TSX).
 *
 * Purpose: "Generating…", empty-state accents, live status labels.
 */

import cs from "classnames";

export type ShinyTextProps = {
  /** Visible label text. */
  text: string;
  /** When true, freeze the shine animation. */
  disabled?: boolean;
  /** Extra class names. */
  className?: string;
  /** Semantic speed: slow cycle is calmer for continuous status. */
  speed?: "slow" | "normal" | "fast";
};

/**
 * @param props text required; empty string still renders an empty span
 * @returns Inline shimmer text span
 */
export function ShinyText(props: ShinyTextProps) {
  const { text, disabled = false, className, speed = "normal" } = props;
  return (
    <span
      className={cs("rb-shiny-text", className, {
        "rb-shiny-text-disabled": disabled,
        "rb-shiny-text-slow": speed === "slow",
        "rb-shiny-text-fast": speed === "fast",
      })}
    >
      {text}
    </span>
  );
}
