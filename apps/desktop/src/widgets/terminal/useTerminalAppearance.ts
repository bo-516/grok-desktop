/**
 * Live xterm appearance (theme + mono font) read from defineColor tokens.
 * One subscription for the whole dock: re-reads computed styles when the
 * theme / palette attributes on <html> change, and when web fonts finish
 * loading (xterm must re-measure glyphs once JetBrains Mono arrives).
 */

import type { ITheme } from "@xterm/xterm";
import { useEffect, useState } from "react";
import { buildTerminalTheme, terminalThemeKey } from "@/lib/terminalTheme";

/** What every xterm host applies through xterm's options API. */
export type TerminalAppearance = {
  /** xterm theme built from --color-terminal-* tokens. */
  theme: ITheme;
  /** CSS font-family list from --font-mono. */
  fontFamily: string;
  /** Bumps when web fonts finished loading, so hosts re-measure glyphs. */
  fontEpoch: number;
  /** Fingerprint of theme + font; equal keys mean nothing to re-apply. */
  key: string;
};

/** Attributes on <html> that retint the token ladder. */
const THEME_ATTRIBUTES = ["data-theme", "data-palette", "class", "style"];

/** Fallback font when --font-mono is missing (Node / broken stylesheet). */
const FALLBACK_FONT = "ui-monospace, Menlo, Consolas, monospace";

/**
 * Read the current appearance from computed styles on <html>.
 * @param fontEpoch Font-load generation to stamp into the result.
 * @returns Appearance; an empty theme outside the browser.
 */
function readTerminalAppearance(fontEpoch: number): TerminalAppearance {
  if (typeof document === "undefined") {
    return { theme: {}, fontFamily: FALLBACK_FONT, fontEpoch, key: "" };
  }
  const style = getComputedStyle(document.documentElement);
  const theme = buildTerminalTheme((token) => style.getPropertyValue(token).trim());
  const fontFamily = style.getPropertyValue("--font-mono").trim() || FALLBACK_FONT;
  return {
    theme,
    fontFamily,
    fontEpoch,
    key: `${terminalThemeKey(theme)}|${fontFamily}|${fontEpoch}`,
  };
}

/**
 * Subscribe to theme / palette / font changes.
 * @returns The current appearance; identity changes only when its key does.
 */
export function useTerminalAppearance(): TerminalAppearance {
  const [appearance, setAppearance] = useState(() => readTerminalAppearance(0));

  useEffect(() => {
    /**
     * Re-read styles; keep the previous object when nothing changed.
     * @param bumpFont True after a web-font load event.
     */
    const refresh = (bumpFont: boolean) => {
      setAppearance((prev) => {
        const next = readTerminalAppearance(prev.fontEpoch + (bumpFont ? 1 : 0));
        return next.key === prev.key ? prev : next;
      });
    };
    const onAttributes = () => refresh(false);
    const onFonts = () => refresh(true);
    const observer = new MutationObserver(onAttributes);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: THEME_ATTRIBUTES,
    });
    window.addEventListener("grok-desktop:theme-changed", onAttributes);
    window.addEventListener("grok-desktop:palette-changed", onAttributes);
    const fonts = typeof document.fonts === "undefined" ? null : document.fonts;
    fonts?.addEventListener("loadingdone", onFonts);
    void fonts?.ready.then(onFonts);
    return () => {
      observer.disconnect();
      window.removeEventListener("grok-desktop:theme-changed", onAttributes);
      window.removeEventListener("grok-desktop:palette-changed", onAttributes);
      fonts?.removeEventListener("loadingdone", onFonts);
    };
  }, []);

  return appearance;
}
