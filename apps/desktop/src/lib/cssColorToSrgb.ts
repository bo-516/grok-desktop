/**
 * Convert a *computed* CSS color string to an sRGB string xterm.js can parse.
 *
 * Why: xterm only parses `#hex` and comma `rgb()/rgba()` reliably (its canvas
 * fallback rejects translucent colors and varies by engine), while the app's
 * tokens compute to `oklch(…)` / `color(srgb …)` / space-separated `rgb()`.
 * Pure math, no DOM: unit-tested in Node.
 *
 * Supported inputs: `#rgb[a]`, `#rrggbb[aa]`, `rgb()/rgba()` (comma or space
 * syntax, % channels), `oklch()`, `oklab()`, `color(srgb|srgb-linear|display-p3 …)`,
 * and `transparent`. Anything else returns undefined so callers can fall
 * back to xterm's default for that slot.
 */

/** sRGB channels 0–255 plus alpha 0–1. */
export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * Parse one numeric CSS component.
 * @param raw Token such as `0.5`, `50%`, `120deg`, `none`.
 * @param percentScale Value that 100% maps to (1 for alpha/L, 0.4 for oklch C, 255 for rgb).
 * @returns The number, or NaN when unparseable.
 */
function parseComponent(raw: string, percentScale: number): number {
  const token = raw.trim().toLowerCase();
  if (token === "none") {
    return 0;
  }
  if (token.endsWith("%")) {
    return (parseFloat(token) / 100) * percentScale;
  }
  if (token.endsWith("deg")) {
    return parseFloat(token);
  }
  return parseFloat(token);
}

/**
 * Split a functional-notation body into channel tokens and alpha.
 * @param body Text between the parentheses, e.g. `0.5 0.1 20 / 0.3` or `1, 2, 3, 0.5`.
 * @returns Channel tokens and the alpha token (undefined when absent).
 */
function splitChannels(body: string): { channels: string[]; alpha?: string } {
  const [main, slashAlpha] = body.split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (slashAlpha !== undefined) {
    return { channels: parts, alpha: slashAlpha.trim() };
  }
  // Legacy comma syntax carries alpha as the 4th channel; space syntax never
  // does (`color(srgb r g b)` has four tokens and no alpha).
  return main.includes(",") && parts.length === 4
    ? { channels: parts.slice(0, 3), alpha: parts[3] }
    : { channels: parts };
}

/**
 * sRGB transfer function (linear → gamma-encoded), result scaled to 0–255.
 * @param linear Linear-light channel (may be out of gamut; clamped).
 */
function encodeSrgb(linear: number): number {
  const c = Math.min(Math.max(linear, 0), 1);
  const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/**
 * Inverse sRGB transfer function (gamma-encoded 0–1 → linear).
 * @param encoded Gamma-encoded channel 0–1.
 */
function decodeSrgb(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/**
 * OKLab → linear sRGB (Björn Ottosson's reference matrices).
 * @param l Lightness 0–1; a / b Opponent axes.
 * @returns Linear sRGB triple (may be out of gamut).
 */
function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/**
 * Linear Display P3 → linear sRGB.
 * @param rgb Linear P3 triple.
 */
function linearP3ToLinearSrgb([r, g, b]: [number, number, number]): [number, number, number] {
  return [
    1.2249401 * r - 0.2249404 * g,
    -0.0420569 * r + 1.0420571 * g,
    -0.0196376 * r - 0.0786361 * g + 1.0982735 * b,
  ];
}

/**
 * Parse a hex color.
 * @param hex `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 */
function parseHex(hex: string): Rgba | undefined {
  const digits = hex.slice(1);
  if (!/^[\da-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) {
    return undefined;
  }
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const n = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { r: n(0), g: n(1), b: n(2), a: full.length === 8 ? n(3) / 255 : 1 };
}

/**
 * Parse a computed CSS color into sRGB channels.
 * @param input Computed color text (whitespace tolerated, case-insensitive).
 * @returns Channels, or undefined for unsupported / malformed input.
 */
export function parseCssColor(input: string): Rgba | undefined {
  const text = input.trim().toLowerCase();
  if (text === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (text.startsWith("#")) {
    return parseHex(text);
  }
  const match = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (!match) {
    return undefined;
  }
  const [, fn, body] = match;
  const { channels, alpha } = splitChannels(body);
  const a = alpha === undefined ? 1 : parseComponent(alpha, 1);
  let linear: [number, number, number] | undefined;
  if ((fn === "rgb" || fn === "rgba") && channels.length === 3) {
    const [r, g, b] = channels.map((c) => parseComponent(c, 255));
    return finish(r, g, b, a);
  }
  if (fn === "oklch" && channels.length === 3) {
    const [l, c, h] = [parseComponent(channels[0], 1), parseComponent(channels[1], 0.4), parseComponent(channels[2], 1)];
    const rad = (h * Math.PI) / 180;
    linear = oklabToLinearSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
  } else if (fn === "oklab" && channels.length === 3) {
    linear = oklabToLinearSrgb(parseComponent(channels[0], 1), parseComponent(channels[1], 0.4), parseComponent(channels[2], 0.4));
  } else if (fn === "color" && channels.length === 4) {
    const [space, ...rest] = channels;
    const values = rest.map((c) => parseComponent(c, 1)) as [number, number, number];
    if (space === "srgb") {
      linear = values.map(decodeSrgb) as [number, number, number];
    } else if (space === "srgb-linear") {
      linear = values;
    } else if (space === "display-p3") {
      linear = linearP3ToLinearSrgb(values.map(decodeSrgb) as [number, number, number]);
    }
  }
  if (!linear) {
    return undefined;
  }
  return finish(encodeSrgb(linear[0]), encodeSrgb(linear[1]), encodeSrgb(linear[2]), a);
}

/**
 * Clamp + round channels; reject NaN.
 * @param r / g / b Channels 0–255 (unclamped). @param a Alpha 0–1 (unclamped).
 */
function finish(r: number, g: number, b: number, a: number): Rgba | undefined {
  if ([r, g, b, a].some((v) => Number.isNaN(v))) {
    return undefined;
  }
  const byte = (v: number) => Math.round(Math.min(Math.max(v, 0), 255));
  return { r: byte(r), g: byte(g), b: byte(b), a: Math.min(Math.max(a, 0), 1) };
}

/**
 * Format channels the way xterm parses fastest.
 * @param color Parsed channels.
 * @returns `#rrggbb` when opaque, else `rgba(r, g, b, a)` with ≤3 decimals.
 */
export function formatXtermColor(color: Rgba): string {
  if (color.a >= 1) {
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  }
  const alpha = Number(color.a.toFixed(3));
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/**
 * Computed CSS color → xterm color string.
 * @param input Computed color text (e.g. from getComputedStyle).
 * @returns xterm-ready color, or undefined when the input is not a supported color.
 */
export function cssColorToXterm(input: string): string | undefined {
  const parsed = parseCssColor(input);
  return parsed ? formatXtermColor(parsed) : undefined;
}
