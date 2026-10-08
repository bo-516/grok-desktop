/**
 * xterm.js theme built from the app's `--color-terminal-*` tokens
 * (src/styles/defineColor.css). Colors are never authored here: each xterm
 * slot names the token it reads, the caller supplies computed values
 * (getComputedStyle), and cssColorToSrgb turns them into strings xterm parses.
 */

import type { ITheme } from "@xterm/xterm";
import { formatXtermColor, parseCssColor } from "./cssColorToSrgb";

/** xterm theme slot → defineColor token, in xterm's documentation order. */
export const TERMINAL_THEME_TOKENS: ReadonlyArray<readonly [keyof ITheme, string]> = [
  ["background", "--color-terminal-bg"],
  ["foreground", "--color-terminal-fg"],
  ["cursor", "--color-terminal-cursor"],
  ["cursorAccent", "--color-terminal-cursor-accent"],
  ["selectionBackground", "--color-terminal-selection"],
  ["selectionInactiveBackground", "--color-terminal-selection-inactive"],
  ["scrollbarSliderBackground", "--color-terminal-scrollbar"],
  ["scrollbarSliderHoverBackground", "--color-terminal-scrollbar-hover"],
  ["scrollbarSliderActiveBackground", "--color-terminal-scrollbar-active"],
  ["black", "--color-terminal-ansi-black"],
  ["red", "--color-terminal-ansi-red"],
  ["green", "--color-terminal-ansi-green"],
  ["yellow", "--color-terminal-ansi-yellow"],
  ["blue", "--color-terminal-ansi-blue"],
  ["magenta", "--color-terminal-ansi-magenta"],
  ["cyan", "--color-terminal-ansi-cyan"],
  ["white", "--color-terminal-ansi-white"],
  ["brightBlack", "--color-terminal-ansi-bright-black"],
  ["brightRed", "--color-terminal-ansi-bright-red"],
  ["brightGreen", "--color-terminal-ansi-bright-green"],
  ["brightYellow", "--color-terminal-ansi-bright-yellow"],
  ["brightBlue", "--color-terminal-ansi-bright-blue"],
  ["brightMagenta", "--color-terminal-ansi-bright-magenta"],
  ["brightCyan", "--color-terminal-ansi-bright-cyan"],
  ["brightWhite", "--color-terminal-ansi-bright-white"],
];

/** Opaque slots: xterm draws them as solid fills, so alpha is dropped. */
const OPAQUE_SLOTS = new Set<keyof ITheme>(["background", "cursorAccent"]);

/**
 * Build an xterm theme from token values.
 * @param readToken Returns the computed value of a custom property (e.g.
 *   `getComputedStyle(el).getPropertyValue(name)`); "" when unset.
 * @returns Theme with every slot whose token resolved to a supported color.
 *   Unresolvable slots are omitted so xterm keeps its own default for them
 *   (e.g. an engine without @property support returns token text).
 */
export function buildTerminalTheme(readToken: (token: string) => string): ITheme {
  const theme: ITheme = {};
  for (const [slot, token] of TERMINAL_THEME_TOKENS) {
    const raw = readToken(token);
    const parsed = raw ? parseCssColor(raw) : undefined;
    if (!parsed) {
      continue;
    }
    Object.assign(theme, {
      [slot]: formatXtermColor(OPAQUE_SLOTS.has(slot) ? { ...parsed, a: 1 } : parsed),
    });
  }
  return theme;
}

/**
 * Stable fingerprint of a theme so callers skip redundant xterm updates.
 * @param theme Theme from buildTerminalTheme.
 * @returns String that changes iff any slot changes.
 */
export function terminalThemeKey(theme: ITheme): string {
  return TERMINAL_THEME_TOKENS.map(([slot]) => String(theme[slot] ?? "")).join("|");
}
