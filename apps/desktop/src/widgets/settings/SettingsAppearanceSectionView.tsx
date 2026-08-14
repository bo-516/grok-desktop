/**
 * Settings drawer — UI color palette + chrome toggles (instant, no restart).
 * Stateless presentation; parent owns palette/theme/usage-chrome state.
 */

import cs from "classnames";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  COLOR_PALETTE_OPTIONS,
  isPaletteOptionActive,
  type ColorPaletteId,
  type ColorPaletteOption,
} from "@/lib/colorPalette";
import type { ThemeId } from "@/lib/theme";

export type SettingsAppearanceSectionViewProps = {
  /** Current theme polarity (affects mono black/white active state). */
  theme: ThemeId;
  /** Current palette id. */
  palette: ColorPaletteId;
  /**
   * One-click UI color: black/white force mono+theme; hues retint accents.
   * @param option Swatch from COLOR_PALETTE_OPTIONS
   */
  onPickPalette: (option: ColorPaletteOption) => void;
  /**
   * When true, the composer shows a context-usage ring left of the model name
   * (live occupancy vs window; hover lists last-turn billed token usage).
   */
  showContextUsage: boolean;
  /**
   * Toggle the composer context meter; applies instantly (no session restart).
   * @param show Next visibility value
   */
  onShowContextUsageChange: (show: boolean) => void;
  /**
   * When true, the composer shows weekly (or monthly) remaining allowance
   * immediately left of the context ring.
   */
  showWeeklyUsage: boolean;
  /**
   * Toggle the weekly remaining chip; applies instantly (no session restart).
   * @param show Next visibility value
   */
  onShowWeeklyUsageChange: (show: boolean) => void;
};

/**
 * Render the "Appearance" section of Session settings (color + chrome).
 *
 * Swatches carry no visible caption — at drawer width they clipped to "Bla…" /
 * "Oran…" and turned a 10-swatch row into noise. The name of the active option
 * is printed once below the row instead, and each button keeps its title +
 * aria-label so hover and screen readers still name every colour.
 *
 * Context + weekly remaining are pure UI chrome toggles (F-CTX-01): no SPAWN dirty state.
 *
 * @param props theme/palette/usage-chrome snapshot + handlers
 */
export function SettingsAppearanceSectionView(
  props: SettingsAppearanceSectionViewProps,
) {
  const activeOption = COLOR_PALETTE_OPTIONS.find((option) =>
    isPaletteOptionActive(option, props.palette, props.theme),
  );
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">Appearance</h3>
      <p className="side-panel-hint">
        Color and chrome apply instantly — no session restart.
      </p>
      <ul className="palette-picker" aria-label="UI color palette">
        {COLOR_PALETTE_OPTIONS.map((option, index) => {
          const active = isPaletteOptionActive(
            option,
            props.palette,
            props.theme,
          );
          const key = `${option.id}-${option.forceTheme ?? "accent"}-${index}`;
          return (
            <li key={key} className="palette-picker-item">
              <button
                type="button"
                className="palette-swatch-btn"
                title={option.label}
                aria-label={`UI color ${option.label}`}
                aria-pressed={active}
                onClick={() => props.onPickPalette(option)}
              >
                <span
                  className={cs(option.swatchClass, {
                    "palette-swatch-active": active,
                  })}
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="palette-current">
        {activeOption ? activeOption.label : "Custom"} · retints surfaces, text
        and accents instantly.
      </p>

      <div className="panel-group">
        <Checkbox
          className="panel-row"
          checked={props.showWeeklyUsage}
          onChange={(e) => props.onShowWeeklyUsageChange(e.target.checked)}
          label="Show weekly remaining"
          description="Allowance left this week (or month) immediately left of the context ring."
        />
        <Checkbox
          className="panel-row"
          checked={props.showContextUsage}
          onChange={(e) => props.onShowContextUsageChange(e.target.checked)}
          label="Show context usage"
          description="Ring left of the model name: live context fill vs window. Hover shows occupancy and last-turn token usage separately."
        />
      </div>
    </section>
  );
}
