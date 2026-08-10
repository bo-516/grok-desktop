/**
 * Unit tests for composer IME key gating — Enter must not send while composing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isComposerImeKey } from "@/widgets/composer/useComposerWidget";

/**
 * Builds a minimal keyboard-event-shaped object for isComposerImeKey.
 * @param isComposing nativeEvent.isComposing value.
 * @param keyCode KeyboardEvent.keyCode (229 = IME marker).
 */
function fakeKey(isComposing: boolean, keyCode: number) {
  return {
    keyCode,
    nativeEvent: { isComposing },
  };
}

describe("isComposerImeKey", () => {
  it("returns false for a normal Enter when not composing", () => {
    assert.equal(isComposerImeKey(fakeKey(false, 13), false), false);
  });

  it("returns true when the session composition ref is set", () => {
    assert.equal(isComposerImeKey(fakeKey(false, 13), true), true);
  });

  it("returns true when nativeEvent.isComposing is set", () => {
    assert.equal(isComposerImeKey(fakeKey(true, 13), false), true);
  });

  it("returns true for keyCode 229 (IME composition marker)", () => {
    assert.equal(isComposerImeKey(fakeKey(false, 229), false), true);
  });
});
