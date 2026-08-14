/**
 * Composer weekly-remaining chip — account allowance left this period.
 * Stateless: parent supplies a prebuilt WeeklyUsageDisplay view-model.
 * Placement: composer-bar-right, immediately left of the context-usage ring.
 * Hover / keyboard :focus-visible opens a multi-line tip above (same chrome
 * as ctx). Pointer click does not pin the bubble.
 */

import cs from "classnames";
import type { WeeklyUsageDisplay } from "@/lib/weeklyUsageDisplay";

export type ComposerWeeklyUsageViewProps = {
  /** Precomputed remaining percent, chip text, tone, tooltip, aria label. */
  display: WeeklyUsageDisplay;
};

/**
 * Compact remaining-allowance chip (F-CTX-01 sibling).
 * Track + text use design tokens via shortcuts; hover tip is pure CSS
 * (`group-hover` / `group-focus-visible`) so a click cannot pin the bubble.
 * @param props display view-model from buildWeeklyUsageDisplay
 */
export function ComposerWeeklyUsageView(props: ComposerWeeklyUsageViewProps) {
  const { display } = props;
  const { tooltip } = display;
  return (
    <span
      className="composer-weekly group"
      aria-label={display.label}
      tabIndex={0}
      onMouseDown={(e) => {
        // Pointer click must not focus the host; :focus would pin the tip.
        e.preventDefault();
      }}
    >
      <span className="composer-weekly-period">{display.periodWord}</span>
      <span
        className={cs("composer-weekly-value", {
          "composer-weekly-value-ok": display.tone === "ok",
          "composer-weekly-value-warn": display.tone === "warn",
          "composer-weekly-value-danger": display.tone === "danger",
        })}
      >
        {display.remainingPercent}%
      </span>
      <span className="composer-weekly-tip" role="tooltip">
        <span className="composer-usage-tip-title">{tooltip.title}</span>
        <span className="composer-usage-tip-line">{tooltip.remainingLine}</span>
        {tooltip.resetLine ? (
          <span className="composer-usage-tip-line">{tooltip.resetLine}</span>
        ) : null}
      </span>
    </span>
  );
}
