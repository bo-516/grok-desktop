/**
 * Terminal chords: ⌘J / Ctrl+J toggle and Ctrl+Shift+C / V clipboard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMacPlatform,
  isTerminalToggleChord,
  terminalClipboardChord,
  type KeyChord,
} from "@/lib/terminalKeys";

/** Key event stub with every modifier off unless set. */
function chord(partial: Partial<KeyChord>): KeyChord {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("terminalKeys", () => {
  it("detects macOS from platform or user agent", () => {
    assert.equal(isMacPlatform({ platform: "MacIntel" }), true);
    assert.equal(isMacPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), false);
    assert.equal(isMacPlatform(null), false);
  });

  it("toggles on ⌘J on mac and Ctrl+J elsewhere only", () => {
    assert.equal(isTerminalToggleChord(chord({ key: "j", metaKey: true }), true), true);
    assert.equal(isTerminalToggleChord(chord({ key: "j", ctrlKey: true }), true), false);
    assert.equal(isTerminalToggleChord(chord({ key: "J", code: "KeyJ", ctrlKey: true }), false), true);
    assert.equal(isTerminalToggleChord(chord({ key: "j", metaKey: true }), false), false);
    assert.equal(isTerminalToggleChord(chord({ key: "j", metaKey: true, shiftKey: true }), true), false);
    assert.equal(isTerminalToggleChord(chord({ key: "k", metaKey: true }), true), false);
    // Non-latin layout: physical KeyJ still matches.
    assert.equal(isTerminalToggleChord(chord({ key: "о", code: "KeyJ", metaKey: true }), true), true);
  });

  it("maps Ctrl+Shift+C / V to clipboard on Windows / Linux only", () => {
    assert.equal(terminalClipboardChord(chord({ key: "C", ctrlKey: true, shiftKey: true }), false), "copy");
    assert.equal(terminalClipboardChord(chord({ key: "V", ctrlKey: true, shiftKey: true }), false), "paste");
    assert.equal(terminalClipboardChord(chord({ key: "c", ctrlKey: true }), false), null);
    assert.equal(terminalClipboardChord(chord({ key: "C", ctrlKey: true, shiftKey: true }), true), null);
  });
});
