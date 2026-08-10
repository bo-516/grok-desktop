/**
 * Unit tests for modal focus helpers (list + Tab cycle decisions).
 * Uses a minimal DOM under happy-dom is not wired — assert pure selector
 * and trap branch logic via jsdom-free structural checks where possible.
 * Runtime DOM methods are exercised with a lightweight stub document.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOCUSABLE_SELECTOR,
  listFocusable,
  trapFocusTab,
} from "../../src/lib/focusTrap.js";

describe("focusTrap", () => {
  it("exports a non-empty focusable selector covering buttons and fields", () => {
    assert.match(FOCUSABLE_SELECTOR, /button/);
    assert.match(FOCUSABLE_SELECTOR, /input/);
    assert.match(FOCUSABLE_SELECTOR, /textarea/);
    assert.match(FOCUSABLE_SELECTOR, /tabindex/);
  });

  it("listFocusable returns [] for null root", () => {
    assert.deepEqual(listFocusable(null), []);
    assert.deepEqual(listFocusable(undefined), []);
  });

  it("trapFocusTab ignores non-Tab keys", () => {
    const root = {
      focus() {},
      contains() {
        return true;
      },
      querySelectorAll() {
        return [];
      },
    } as unknown as HTMLElement;
    const event = {
      key: "Escape",
      preventDefault() {
        assert.fail("should not preventDefault for Escape");
      },
      shiftKey: false,
    } as unknown as KeyboardEvent;
    assert.equal(trapFocusTab(event, root), false);
  });
});
