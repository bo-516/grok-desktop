/**
 * Composer context-usage pie — live context fill vs model context window.
 * Stateless: parent supplies a prebuilt ContextUsageDisplay view-model.
 * Placement: composer-bar-right, immediately left of the model name chip.
 * Parent only mounts this when occupancy is known (see isContextUsageReady);
 * first paint runs composer-usage-reveal so Weekly slides left, then the pie
 * fades in. Hover / keyboard :focus-visible opens a multi-line tip: occupancy
 * first, then last-turn billed token usage when those counters exist.
 * A pointer click does not pin the bubble (mousedown preventDefault + CSS).
 */

import cs from "classnames";
import {
  contextUsagePiePath,
  type ContextUsageDisplay,
} from "@/lib/contextUsageDisplay";

/**
 * Solid pie in a 14-unit viewBox that fills the 14×14 CSS-pixel box.
 * `composer-usage-svg` uses `w-14px` (not rem) so a 13px root cannot shrink
 * the disk back to ~10px. Geometry is a filled sector.
 */
const PIE_SIZE = 14;
const PIE_CX = PIE_SIZE / 2;
const PIE_CY = PIE_SIZE / 2;
const PIE_R = PIE_SIZE / 2;

export type ComposerContextUsageViewProps = {
  /** Precomputed counts, percent, tone, tooltip lines, and accessibility label. */
  display: ContextUsageDisplay;
};

/**
 * Solid circular pie for session context fill (F-CTX-01).
 * Track disk + sector use the same muted / warning / danger tokens as the
 * weekly chip so the meter does not light up in brand next to bar chrome.
 * Enter motion (width then opacity) lives on `.composer-usage` in base.css
 * so a late occupancy stamp pushes Weekly instead of popping the disk in.
 * Hover tip is pure CSS (`group-hover` / `group-focus-visible`) — no portal.
 * Mouse click must not pin the bubble; keyboard Tab still reveals it.
 * Tip lists window occupancy first, then last-turn billed usage when present.
 * @param props display view-model from buildContextUsageDisplay
 */
export function ComposerContextUsageView(props: ComposerContextUsageViewProps) {
  const { display } = props;
  const { tooltip } = display;
  /** Sector path; empty when fill is 0 so only the muted track disk shows. */
  const pieD = contextUsagePiePath(display.fillPercent, PIE_CX, PIE_CY, PIE_R);
  /** Tone class only — fill color comes from shortcuts, never a literal. */
  const fillClass = cs("composer-usage-fill", {
    "composer-usage-fill-idle": display.tone === "idle",
    "composer-usage-fill-ok": display.tone === "ok",
    "composer-usage-fill-warn": display.tone === "warn",
    "composer-usage-fill-danger": display.tone === "danger",
  });
  return (
    <span
      className="composer-usage group"
      aria-label={display.label}
      tabIndex={0}
      onMouseDown={(e) => {
        // Pointer click must not focus the host; :focus would pin the tip.
        e.preventDefault();
      }}
    >
      <svg
        className="composer-usage-svg"
        viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
        width={PIE_SIZE}
        height={PIE_SIZE}
        aria-hidden="true"
      >
        <circle
          className="composer-usage-track"
          cx={PIE_CX}
          cy={PIE_CY}
          r={PIE_R}
        />
        {pieD ? <path className={fillClass} d={pieD} /> : null}
      </svg>
      {/*
        Multi-line occupancy + usage bubble (not native title — browsers delay
        and single-line). Occupancy never uses "used N tokens"; billed usage
        is a second section so the two stats stay distinct.
      */}
      <span className="composer-usage-tip" role="tooltip">
        <span className="composer-usage-tip-title">{tooltip.title}</span>
        {/* Skip blank occupancy lines so the pre-first-turn fallback stays two lines. */}
        {tooltip.percentLine ? (
          <span className="composer-usage-tip-line">{tooltip.percentLine}</span>
        ) : null}
        {tooltip.occupancyLine ? (
          <span className="composer-usage-tip-line">{tooltip.occupancyLine}</span>
        ) : null}
        {tooltip.usageLine ? (
          <>
            <span className="composer-usage-tip-divider" aria-hidden="true" />
            <span className="composer-usage-tip-title">
              {tooltip.usageTitle ?? "Last turn usage"}
            </span>
            <span className="composer-usage-tip-line">{tooltip.usageLine}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
