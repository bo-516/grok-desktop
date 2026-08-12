/**
 * Composer context-usage ring — last-turn fill vs model context window.
 * Stateless: parent supplies a prebuilt ContextUsageDisplay view-model.
 * Placement: composer-bar-right, immediately left of the model name chip.
 * Hover / keyboard focus opens a Cursor-style multi-line usage tip above.
 */

import cs from "classnames";
import type { ContextUsageDisplay } from "@/lib/contextUsageDisplay";

/** SVG geometry for a 20px ring with a 2px stroke (r = 8, C ≈ 50.27). */
const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

export type ComposerContextUsageViewProps = {
  /** Precomputed counts, percent, tone, tooltip lines, and accessibility label. */
  display: ContextUsageDisplay;
};

/**
 * Circular progress for session context fill (F-CTX-01).
 * Track + fill use design tokens via shortcuts; dashoffset is the only
 * geometry-driven React style (not a color). Hover tip is pure CSS
 * (`group-hover` / `group-focus-within`) so no portal or Radix Tooltip.
 * @param props display view-model from buildContextUsageDisplay
 */
export function ComposerContextUsageView(props: ComposerContextUsageViewProps) {
  const { display } = props;
  const offset = RING_C * (1 - display.fillPercent / 100);
  const { tooltip } = display;
  return (
    <span
      className="composer-usage group"
      aria-label={display.label}
      tabIndex={0}
    >
      <svg
        className="composer-usage-svg"
        viewBox="0 0 20 20"
        width="20"
        height="20"
        aria-hidden="true"
      >
        <circle
          className="composer-usage-track"
          cx="10"
          cy="10"
          r={RING_R}
          fill="none"
          strokeWidth="2"
        />
        <circle
          className={cs("composer-usage-fill", {
            "composer-usage-fill-idle": display.tone === "idle",
            "composer-usage-fill-ok": display.tone === "ok",
            "composer-usage-fill-warn": display.tone === "warn",
            "composer-usage-fill-danger": display.tone === "danger",
          })}
          cx="10"
          cy="10"
          r={RING_R}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          // Start at 12 o'clock; dashoffset encodes remaining unfilled arc.
          style={{
            strokeDasharray: RING_C,
            strokeDashoffset: offset,
          }}
          transform="rotate(-90 10 10)"
        />
      </svg>
      {/*
        Multi-line usage bubble (not native title — browsers delay and single-line).
        Visible on hover and keyboard focus so usage is discoverable without a click.
      */}
      <span className="composer-usage-tip" role="tooltip">
        <span className="composer-usage-tip-title">{tooltip.title}</span>
        <span className="composer-usage-tip-line">{tooltip.percentLine}</span>
        <span className="composer-usage-tip-line">{tooltip.tokensLine}</span>
      </span>
    </span>
  );
}
