/**
 * Stale-while-refresh snapshot for the file preview body.
 * Clicking the same path must re-read disk without wiping the last paint.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginFilePreviewLoad,
  type PreviewSource,
} from "@/widgets/preview/usePreviewSource";

/** Idle / loading / error all mean "nothing painted yet". */
const EMPTY_PREV: PreviewSource[] = [
  { status: "idle" },
  { status: "loading" },
  { status: "error", message: "nope" },
];

describe("beginFilePreviewLoad", () => {
  it("returns loading when there is no previous file paint", () => {
    for (const prev of EMPTY_PREV) {
      assert.deepEqual(beginFilePreviewLoad(prev, "/a.ts"), {
        status: "loading",
      });
    }
  });

  it("keeps previous file content and marks refreshing on the same path", () => {
    const prev: PreviewSource = {
      status: "file",
      path: "/a.ts",
      content: "hello",
      truncated: false,
      focusLine: 4,
    };
    const next = beginFilePreviewLoad(prev, "/a.ts", 12);
    assert.deepEqual(next, {
      status: "file",
      path: "/a.ts",
      content: "hello",
      truncated: false,
      focusLine: 12,
      refreshing: true,
    });
  });

  it("clears the focus line when the same path is reopened without one", () => {
    const prev: PreviewSource = {
      status: "file",
      path: "/a.ts",
      content: "hello",
      focusLine: 8,
    };
    const next = beginFilePreviewLoad(prev, "/a.ts");
    assert.equal(next.status, "file");
    if (next.status !== "file") {
      return;
    }
    assert.equal(next.focusLine, undefined);
    assert.equal(next.refreshing, true);
    assert.equal(next.content, "hello");
  });

  it("does not apply a new path's focus line to stale content", () => {
    const prev: PreviewSource = {
      status: "file",
      path: "/a.ts",
      content: "hello",
      focusLine: 3,
    };
    const next = beginFilePreviewLoad(prev, "/b.ts", 99);
    assert.equal(next.status, "file");
    if (next.status !== "file") {
      return;
    }
    assert.equal(next.path, "/a.ts");
    assert.equal(next.content, "hello");
    assert.equal(next.focusLine, 3);
    assert.equal(next.refreshing, true);
  });
});
