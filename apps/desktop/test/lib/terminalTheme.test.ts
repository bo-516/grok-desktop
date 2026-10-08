/**
 * xterm theme from defineColor tokens: every slot maps to a registered
 * --color-terminal-* token, conversion, opaque slots, and missing tokens.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTerminalTheme,
  TERMINAL_THEME_TOKENS,
  terminalThemeKey,
} from "@/lib/terminalTheme";
import { readSrc } from "../helpers/sourceFiles";

describe("terminalTheme", () => {
  it("every token is defined for dark, registered as <color>, and ANSI is overridden for light", () => {
    const css = readSrc("styles/defineColor.css");
    const lightStart = css.indexOf('html[data-theme="light"] {');
    const lightEnd = css.indexOf("}", lightStart);
    const light = css.slice(lightStart, lightEnd);
    for (const [, token] of TERMINAL_THEME_TOKENS) {
      assert.match(css, new RegExp(`${token}:`), `${token} declared`);
      assert.match(css, new RegExp(`@property ${token} \\{ syntax: "<color>"`), `${token} registered`);
      if (token.includes("-ansi-")) {
        assert.match(light, new RegExp(`${token}:`), `${token} has a light value`);
      }
    }
    assert.equal(TERMINAL_THEME_TOKENS.length, 25);
  });

  it("converts computed values and drops alpha on opaque slots", () => {
    const values: Record<string, string> = {
      "--color-terminal-bg": "oklch(0 0 0 / 0.5)",
      "--color-terminal-fg": "rgb(229, 229, 229)",
      "--color-terminal-selection": "oklch(1 0 0 / 0.24)",
      "--color-terminal-ansi-red": "rgb(205, 49, 49)",
    };
    const theme = buildTerminalTheme((token) => values[token] ?? "");
    assert.deepEqual(theme, {
      background: "#000000",
      foreground: "#e5e5e5",
      selectionBackground: "rgba(255, 255, 255, 0.24)",
      red: "#cd3131",
    });
  });

  it("omits unresolvable slots so xterm keeps its defaults", () => {
    const theme = buildTerminalTheme(() => "color-mix(in oklch, var(--x) 20%, transparent)");
    assert.deepEqual(theme, {});
    assert.notEqual(terminalThemeKey({ red: "#000000" }), terminalThemeKey({ red: "#000001" }));
  });
});
