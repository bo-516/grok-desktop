/**
 * UI color palette — whole-page generative scheme via CSS seeds.
 *
 * Changing palette only sets `html[data-palette]`. defineColor.css derives
 * surfaces, text, borders, accents from --seed-brand / --seed-canvas /
 * --seed-ink with OKLCH color-mix (no per-token hex tables in TS).
 *
 * Black/white force mono + dark/light theme; the eight hues retint everything.
 */

export type ColorPaletteId =
  | "mono"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "gray";

/**
 * One picker option: id + label + CSS class for the swatch fill
 * (class maps to --palette-swatch-* tokens — no hex in TSX).
 */
export type ColorPaletteOption = {
  id: ColorPaletteId;
  /** Short human label for a11y / tooltip. */
  label: string;
  /** CSS class on the swatch button face (token background). */
  swatchClass: string;
  /**
   * Optional theme forced when picking this swatch.
   * Black → dark mono, White → light mono; chromatic hues leave theme alone
   * so light/dark + color can combine (full-page tint in both polarities).
   */
  forceTheme?: "dark" | "light";
};

const STORAGE_KEY = "grok-desktop.palette.v1";

/** Ordered swatches: black, white, then the 8 accent systems. */
export const COLOR_PALETTE_OPTIONS: readonly ColorPaletteOption[] = [
  {
    id: "mono",
    label: "Black",
    swatchClass: "palette-swatch palette-swatch-black",
    forceTheme: "dark",
  },
  {
    id: "mono",
    label: "White",
    swatchClass: "palette-swatch palette-swatch-white",
    forceTheme: "light",
  },
  {
    id: "blue",
    label: "Blue",
    swatchClass: "palette-swatch palette-swatch-blue",
  },
  {
    id: "purple",
    label: "Purple",
    swatchClass: "palette-swatch palette-swatch-purple",
  },
  {
    id: "pink",
    label: "Pink",
    swatchClass: "palette-swatch palette-swatch-pink",
  },
  {
    id: "red",
    label: "Red",
    swatchClass: "palette-swatch palette-swatch-red",
  },
  {
    id: "orange",
    label: "Orange",
    swatchClass: "palette-swatch palette-swatch-orange",
  },
  {
    id: "yellow",
    label: "Yellow",
    swatchClass: "palette-swatch palette-swatch-yellow",
  },
  {
    id: "green",
    label: "Green",
    swatchClass: "palette-swatch palette-swatch-green",
  },
  {
    id: "gray",
    label: "Gray",
    swatchClass: "palette-swatch palette-swatch-gray",
  },
] as const;

const VALID: ReadonlySet<string> = new Set([
  "mono",
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "gray",
]);

/**
 * Load persisted palette id; default mono.
 */
export function loadPalette(): ColorPaletteId {
  if (typeof localStorage === "undefined") {
    return "mono";
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID.has(raw)) {
      return raw as ColorPaletteId;
    }
  } catch {
    /* private mode */
  }
  return "mono";
}

/**
 * Persist and apply palette to documentElement as data-palette.
 * CSS seed formulas rebuild the entire page color system from this id.
 * @param palette Palette id; unknown values fall back to mono
 */
export function applyPalette(palette: ColorPaletteId): void {
  const next: ColorPaletteId = VALID.has(palette) ? palette : "mono";
  if (typeof document !== "undefined") {
    document.documentElement.dataset.palette = next;
  }
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ColorPaletteId>("grok-desktop:palette-changed", {
        detail: next,
      }),
    );
  }
}

/**
 * Whether a swatch row entry is the currently selected one.
 * Black/white share mono id — selection also requires matching theme.
 * @param option Swatch option
 * @param palette Active palette id
 * @param theme Active light/dark theme
 */
export function isPaletteOptionActive(
  option: ColorPaletteOption,
  palette: ColorPaletteId,
  theme: "dark" | "light",
): boolean {
  if (option.forceTheme) {
    return palette === "mono" && theme === option.forceTheme;
  }
  return palette === option.id;
}
