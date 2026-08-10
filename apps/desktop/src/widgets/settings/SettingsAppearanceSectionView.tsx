/**
 * Settings drawer — UI color palette swatches (instant, no restart).
 * Stateless presentation; parent owns palette/theme state and pick handler.
 */

import cs from "classnames";
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
};

/**
 * Render the "UI color" section of Session settings.
 *
 * Swatches carry no visible caption — at drawer width they clipped to "Bla…" /
 * "Oran…" and turned a 10-swatch row into noise. The name of the active option
 * is printed once below the row instead, and each button keeps its title +
 * aria-label so hover and screen readers still name every colour.
 *
 * @param props theme/palette snapshot + pick handler
 */
export function SettingsAppearanceSectionView(
  props: SettingsAppearanceSectionViewProps,
) {
  const activeOption = COLOR_PALETTE_OPTIONS.find((option) =>
    isPaletteOptionActive(option, props.palette, props.theme),
  );
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">UI color</h3>
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
    </section>
  );
}
