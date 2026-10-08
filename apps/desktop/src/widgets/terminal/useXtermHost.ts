/**
 * xterm.js lifecycle for one terminal tab, bound to a ref-owned mount node.
 *
 * xterm owns everything it renders inside the node (its own DOM rows / canvas,
 * sizing, selection); this hook only talks to it through xterm's API:
 * create + open on mount, write bridge output (acking after render), forward
 * input / resize to the bridge, apply theme / font, and fit when visible.
 * React never writes render-affecting attributes into that subtree.
 */

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef, type RefObject } from "react";
import type {
  LiveBridgeTerminal,
  TerminalExit,
} from "@/bridge/liveBridgeTerminalTypes";
import { openExternalUrl } from "@/lib/openExternalUrl";
import {
  isMacPlatform,
  isTerminalToggleChord,
  terminalClipboardChord,
} from "@/lib/terminalKeys";
import { terminalExitBanner } from "@/lib/terminalTabs";

/** Inputs of {@link useXtermHost}. */
export type XtermHostOptions = {
  /** Dock tab key, passed back to every callback (lets the dock keep them stable). */
  tabKey: string;
  /** Bridge terminal id; null until the bridge created the shell. */
  terminalId: string | null;
  /** Channel the terminal lives on (fixed per tab). */
  api: LiveBridgeTerminal;
  /** True when the dock is open and this tab is selected (fit + focus). */
  visible: boolean;
  /** xterm theme from defineColor tokens. */
  theme: ITheme;
  /** CSS font-family list for the terminal. */
  fontFamily: string;
  /** Web-font generation; a bump makes xterm re-measure glyphs. */
  fontEpoch: number;
  /** First fit done while terminalId is null: the parent should create the shell. */
  onReady: (tabKey: string, cols: number, rows: number) => void;
  /** The terminal ended (any reason). */
  onExit: (tabKey: string, exit: TerminalExit) => void;
  /** The shell set a window title (OSC 0 / 2). */
  onTitle: (tabKey: string, title: string) => void;
};

/** Scrollback lines kept per terminal. */
const SCROLLBACK_LINES = 5000;

/** Terminal font size in px (matches --font-size-code-sm). */
const FONT_SIZE = 12;

/**
 * Mount and drive one xterm instance.
 * @param options See {@link XtermHostOptions}; callbacks may change identity
 *   every render (they are read through a ref).
 * @returns Ref for the mount node (must be a sized block element).
 */
export function useXtermHost(options: XtermHostOptions): RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const latest = useRef(options);
  const readyRef = useRef(false);
  const { terminalId, api, visible, theme, fontFamily, fontEpoch } = options;

  useEffect(() => {
    latest.current = options;
  });

  // Create xterm once; dispose with the tab.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const mac = isMacPlatform(typeof navigator === "undefined" ? null : navigator);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: latest.current.fontFamily,
      fontSize: FONT_SIZE,
      scrollback: SCROLLBACK_LINES,
      theme: latest.current.theme,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => void openExternalUrl(uri)));
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && isTerminalToggleChord(event, mac)) {
        return false; // let the dock's window listener see it
      }
      const clip = event.type === "keydown" ? terminalClipboardChord(event, mac) : null;
      if (clip === "copy" && term.hasSelection()) {
        event.preventDefault();
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      // Paste: skip xterm so the browser's own paste event feeds it.
      return clip !== "paste";
    });
    const titleSub = term.onTitleChange((title) =>
      latest.current.onTitle(latest.current.tabKey, title),
    );
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    return () => {
      titleSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Wire the bridge stream once the terminal exists on the bridge.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !terminalId) {
      return undefined;
    }
    const unsubscribe = api.subscribe(terminalId, {
      onOutput: (bytes) => term.write(bytes, () => api.ack(terminalId, bytes.length)),
      onExit: (exit) => {
        term.write(terminalExitBanner(exit));
        latest.current.onExit(latest.current.tabKey, exit);
      },
    });
    const subs = [
      term.onData((data) => api.write(terminalId, data)),
      term.onBinary((data) => api.writeBinary(terminalId, data)),
      term.onResize(({ cols, rows }) => api.resize(terminalId, cols, rows)),
    ];
    // The shell started at the size measured before create; resync in case
    // the dock moved since.
    api.resize(terminalId, term.cols, term.rows);
    return () => {
      unsubscribe();
      subs.forEach((s) => s.dispose());
    };
  }, [api, terminalId]);

  // Fit + focus when shown; announce the first size while not yet created.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!visible || !term || !fit) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      safeFit(fit);
      term.focus();
      if (!readyRef.current && !latest.current.terminalId) {
        readyRef.current = true;
        latest.current.onReady(latest.current.tabKey, term.cols, term.rows);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  // Refit on container resize (dock drag, window resize, rail push).
  useEffect(() => {
    const host = hostRef.current;
    const fit = fitRef.current;
    if (!visible || !host || !fit || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const pending = { frame: 0 };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending.frame);
      pending.frame = requestAnimationFrame(() => safeFit(fit));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(pending.frame);
      observer.disconnect();
    };
  }, [visible]);

  // Theme / font follow the app tokens.
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.theme = theme;
    }
  }, [theme]);
  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    // A changed value makes xterm re-measure glyphs; alternating a redundant
    // generic fallback forces that after each web-font load.
    term.options.fontFamily = fontEpoch % 2 ? `${fontFamily}, monospace` : fontFamily;
    if (latest.current.visible && fitRef.current) {
      safeFit(fitRef.current);
    }
  }, [fontFamily, fontEpoch]);

  return hostRef;
}

/**
 * Fit xterm to its container, ignoring the throw xterm raises while the
 * container has no layout box (hidden dock / tab).
 * @param fit The tab's fit addon.
 */
function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // not laid out yet — the next visibility / resize pass fits it
  }
}
