/**
 * `cn` (clsx + tailwind-merge) with the UnoCSS-only font sizes this app adds.
 * Plain tailwind-merge files unknown `text-*` values under text color, which
 * would silently drop sizes like `text-12px` next to `text-fg`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MENU_CHECK_ROW_CLASS,
  MENU_ROW_CLASS,
  MENU_ROW_DESTRUCTIVE_CLASS,
  MENU_SUB_TRIGGER_OPEN_CLASS,
} from "@/components/ui/menu-classes";
import { cn } from "@/lib/utils";

/**
 * Space-separated classes as a sorted list, for order-free comparison.
 * @param value Class string.
 */
function classSet(value: string): string[] {
  return value.split(/\s+/).filter(Boolean).sort();
}

describe("cn", () => {
  it("joins clsx inputs and skips falsy entries", () => {
    assert.equal(cn("a", false, undefined, ["b"], { c: true, d: false }), "a b c");
  });

  it("lets a later utility override a conflicting earlier one", () => {
    assert.equal(cn("px-2 py-1", "px-4"), "py-1 px-4");
    assert.equal(cn("text-fg", "text-danger"), "text-danger");
  });

  it("keeps UnoCSS px font sizes next to text colors", () => {
    assert.equal(cn("text-12px text-fg"), "text-12px text-fg");
    assert.equal(cn("text-12px", "text-14px"), "text-14px");
  });

  it("keeps theme font sizes (text-nav, text-body-sm) next to text colors", () => {
    assert.equal(cn("text-nav text-fg-muted"), "text-nav text-fg-muted");
    assert.equal(cn("text-body-sm", "text-nav"), "text-nav");
  });

  it("drops none of the bridged menu row classes when they are combined", () => {
    for (const extra of [
      MENU_ROW_DESTRUCTIVE_CLASS,
      MENU_CHECK_ROW_CLASS,
      MENU_SUB_TRIGGER_OPEN_CLASS,
    ]) {
      assert.deepEqual(
        classSet(cn(MENU_ROW_CLASS, extra)),
        classSet(`${MENU_ROW_CLASS} ${extra}`),
      );
    }
  });
});
