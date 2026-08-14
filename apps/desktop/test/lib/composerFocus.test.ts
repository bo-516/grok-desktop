/**
 * Composer focus helpers: New chat dispatches a window event; schedule waits
 * two animation frames and skips a disabled textarea.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FOCUS_COMPOSER_EVENT,
  focusComposer,
  scheduleComposerFocus,
} from "@/lib/composerFocus";

/** Restore requestAnimationFrame after stubs. */
const originalRaf = globalThis.requestAnimationFrame;

afterEach(() => {
  if (originalRaf) {
    globalThis.requestAnimationFrame = originalRaf;
  } else {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  }
});

describe("composerFocus", () => {
  it("focusComposer is a no-op without window", () => {
    const hadWindow = typeof globalThis.window !== "undefined";
    const prev = hadWindow ? globalThis.window : undefined;
    Reflect.deleteProperty(globalThis, "window");
    try {
      assert.doesNotThrow(() => focusComposer());
    } finally {
      if (hadWindow && prev) {
        globalThis.window = prev;
      }
    }
  });

  it("focusComposer dispatches FOCUS_COMPOSER_EVENT on window", () => {
    const types: string[] = [];
    const prev = globalThis.window;
    globalThis.window = {
      dispatchEvent(event: Event) {
        types.push(event.type);
        return true;
      },
    } as unknown as Window & typeof globalThis;
    try {
      focusComposer();
      assert.deepEqual(types, [FOCUS_COMPOSER_EVENT]);
    } finally {
      if (prev) {
        globalThis.window = prev;
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("scheduleComposerFocus focuses after two animation frames", () => {
    const queued: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof requestAnimationFrame;
    let focused = 0;
    const el = {
      disabled: false,
      focus() {
        focused += 1;
      },
    } as HTMLTextAreaElement;
    scheduleComposerFocus(() => el);
    assert.equal(focused, 0);
    assert.equal(queued.length, 1);
    queued[0]!(0);
    assert.equal(focused, 0);
    assert.equal(queued.length, 2);
    queued[1]!(0);
    assert.equal(focused, 1);
  });

  it("scheduleComposerFocus skips a disabled textarea", () => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    let focused = 0;
    const el = {
      disabled: true,
      focus() {
        focused += 1;
      },
    } as HTMLTextAreaElement;
    scheduleComposerFocus(() => el);
    assert.equal(focused, 0);
  });

  it("scheduleComposerFocus runs afterFocus only when focus succeeds", () => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    let after = 0;
    const el = {
      disabled: false,
      focus() {},
    } as HTMLTextAreaElement;
    scheduleComposerFocus(
      () => el,
      () => {
        after += 1;
      },
    );
    assert.equal(after, 1);
  });
});
