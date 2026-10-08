/**
 * Keyboard chords for the integrated terminal. Pure (no DOM writes) so the
 * same decisions drive the window listener and xterm's custom key handler.
 */

/** The KeyboardEvent fields the chord checks read. */
export type KeyChord = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * Whether the host is macOS (⌘ chords) rather than Windows / Linux (Ctrl).
 * @param nav navigator-like object; omitted / missing fields → not mac.
 * @returns True on macOS / iOS user agents.
 */
export function isMacPlatform(
  nav?: { platform?: string; userAgent?: string } | null,
): boolean {
  const hint = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(hint);
}

/**
 * Whether the event's letter is `letter`, by physical key or produced key.
 * @param e Key event.
 * @param letter Lower-case ASCII letter.
 */
function isLetter(e: KeyChord, letter: string): boolean {
  return e.code === `Key${letter.toUpperCase()}` || e.key.toLowerCase() === letter;
}

/**
 * Panel toggle: ⌘J on macOS, Ctrl+J elsewhere. On macOS Ctrl+J is left to the
 * shell (it is a newline there), so only the platform modifier matches.
 * @param e Key event.
 * @param mac Result of isMacPlatform().
 * @returns True when the chord should show / hide the terminal dock.
 */
export function isTerminalToggleChord(e: KeyChord, mac: boolean): boolean {
  if (e.altKey || e.shiftKey || !isLetter(e, "j")) {
    return false;
  }
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * Clipboard chord inside a focused terminal. macOS needs none (⌘C / ⌘V never
 * reach the shell); on Windows / Linux Ctrl+C is SIGINT, so copy / paste use
 * Ctrl+Shift+C / Ctrl+Shift+V like other terminal emulators.
 * @param e Key event.
 * @param mac Result of isMacPlatform().
 * @returns "copy" | "paste", or null when the chord is not a clipboard chord.
 */
export function terminalClipboardChord(
  e: KeyChord,
  mac: boolean,
): "copy" | "paste" | null {
  if (mac || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) {
    return null;
  }
  if (isLetter(e, "c")) {
    return "copy";
  }
  return isLetter(e, "v") ? "paste" : null;
}
