/**
 * Unit tests for the WebView context-menu policy.
 * No jsdom: targets are duck-typed elements with `closest` / `tagName`.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  installBrowserContextMenuSuppressor,
  nativeEditContextMenuShouldStay,
  onBrowserContextMenu,
} from "@/lib/suppressBrowserContextMenu";

/** Minimal element the classifier reads. `closest` decides the field host. */
type FakeEl = {
  tagName: string;
  type?: string;
  disabled?: boolean;
  isContentEditable?: boolean;
  closest: (selector: string) => FakeEl | null;
  getAttribute?: (name: string) => string | null;
  parentElement?: FakeEl | null;
};

/** Ordinary non-editing surface (sidebar row, button chrome, message body). */
function plain(tagName = "DIV"): FakeEl {
  return {
    tagName,
    isContentEditable: false,
    closest: () => null,
  };
}

/** Enabled text control. `closest` returns itself for input/textarea queries. */
function textField(tagName: "INPUT" | "TEXTAREA", extra?: Partial<FakeEl>): FakeEl {
  const el: FakeEl = {
    tagName,
    type: tagName === "INPUT" ? "text" : undefined,
    disabled: false,
    isContentEditable: false,
    closest: (selector) => (selector.includes("input") || selector.includes("textarea") ? el : null),
    ...extra,
  };
  return el;
}

describe("nativeEditContextMenuShouldStay", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("suppresses a null target and ordinary elements", () => {
    assert.equal(nativeEditContextMenuShouldStay(null), false);
    assert.equal(nativeEditContextMenuShouldStay(plain() as unknown as EventTarget), false);
    assert.equal(nativeEditContextMenuShouldStay(plain("BUTTON") as unknown as EventTarget), false);
  });

  it("keeps the menu on an enabled text input and textarea", () => {
    assert.equal(nativeEditContextMenuShouldStay(textField("INPUT") as unknown as EventTarget), true);
    assert.equal(nativeEditContextMenuShouldStay(textField("TEXTAREA") as unknown as EventTarget), true);
    assert.equal(
      nativeEditContextMenuShouldStay(textField("INPUT", { type: "password" }) as unknown as EventTarget),
      true,
    );
  });

  it("suppresses disabled fields and non-text inputs", () => {
    assert.equal(
      nativeEditContextMenuShouldStay(textField("TEXTAREA", { disabled: true }) as unknown as EventTarget),
      false,
    );
    assert.equal(
      nativeEditContextMenuShouldStay(textField("INPUT", { type: "checkbox" }) as unknown as EventTarget),
      false,
    );
    assert.equal(
      nativeEditContextMenuShouldStay(textField("INPUT", { type: "file" }) as unknown as EventTarget),
      false,
    );
  });

  it("keeps the menu for a contenteditable host and not for contenteditable=false", () => {
    const host = plain();
    host.isContentEditable = true;
    assert.equal(nativeEditContextMenuShouldStay(host as unknown as EventTarget), true);

    const off = plain();
    off.closest = (selector) => (selector.includes("contenteditable") ? off : null);
    off.getAttribute = () => "false";
    assert.equal(nativeEditContextMenuShouldStay(off as unknown as EventTarget), false);
  });

  it("keeps the menu when the window selection intersects the target", () => {
    const el = plain();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getSelection: () => ({
          isCollapsed: false,
          rangeCount: 1,
          toString: () => "selected",
          getRangeAt: () => ({ intersectsNode: () => true }),
        }),
      },
    });
    assert.equal(nativeEditContextMenuShouldStay(el as unknown as EventTarget), true);
  });

  it("suppresses when the selection does not intersect the target", () => {
    const el = plain();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getSelection: () => ({
          isCollapsed: false,
          rangeCount: 1,
          toString: () => "selected",
          getRangeAt: () => ({ intersectsNode: () => false }),
        }),
      },
    });
    assert.equal(nativeEditContextMenuShouldStay(el as unknown as EventTarget), false);
  });
});

describe("onBrowserContextMenu", () => {
  it("prevents the default menu on a plain element and leaves a textarea alone", () => {
    let prevented = 0;
    onBrowserContextMenu({
      target: plain() as unknown as EventTarget,
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(prevented, 1);

    onBrowserContextMenu({
      target: textField("TEXTAREA") as unknown as EventTarget,
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(prevented, 1);
  });
});

describe("installBrowserContextMenuSuppressor", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("listens once, in the bubble phase, so React context menus open first", () => {
    const calls: Array<{ type: string; options: unknown }> = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: (type: string, _listener: unknown, options?: unknown) => {
          calls.push({ type, options });
        },
      },
    });
    installBrowserContextMenuSuppressor();
    installBrowserContextMenuSuppressor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.type, "contextmenu");
    // Capture (`true` / `{ capture: true }`) cancels the event before React
    // dispatches it, and Radix ContextMenu then refuses to open.
    assert.equal(calls[0]?.options, undefined);
  });

  it("does nothing without a window", () => {
    assert.doesNotThrow(() => installBrowserContextMenuSuppressor());
  });
});
