/**
 * Full-context patch → whole old/new texts (the git change list renders
 * these through the shared diff engine).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { patchToTexts } from "@/lib/gitPatch";

describe("patchToTexts", () => {
  it("rebuilds both sides of a modified file with full context", () => {
    const patch = [
      "diff --git a/k.txt b/k.txt",
      "index de98044..36ef1ba 100644",
      "--- a/k.txt",
      "+++ b/k.txt",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "-c",
      "+B",
      "+c",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const t = patchToTexts(patch);
    assert.equal(t.oldText, "a\nb\nc\n");
    assert.equal(t.newText, "a\nB\nc");
    assert.equal(t.hunks, 1);
    assert.equal(t.complete, true);
  });

  it("handles added and deleted files", () => {
    const added = patchToTexts("diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+x\n+y\n");
    assert.deepEqual([added.oldText, added.newText, added.complete], ["", "x\ny\n", true]);
    const deleted = patchToTexts("diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n");
    assert.deepEqual([deleted.oldText, deleted.newText], ["gone\n", ""]);
  });

  it("keeps CRLF bytes and a no-newline marker on shared context", () => {
    const t = patchToTexts("@@ -1,2 +1,2 @@\n-a\r\n+A\r\n same\n\\ No newline at end of file\n");
    assert.equal(t.oldText, "a\r\nsame");
    assert.equal(t.newText, "A\r\nsame");
  });

  it("reports zero hunks for rename-only / binary sections", () => {
    const t = patchToTexts("diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n");
    assert.deepEqual(t, { oldText: "", newText: "", hunks: 0, complete: true });
    assert.equal(patchToTexts("").hunks, 0);
  });

  it("flags partial patches (several hunks or not starting at line 1)", () => {
    assert.equal(patchToTexts("@@ -5,2 +5,2 @@\n a\n-b\n+c\n").complete, false);
    assert.equal(patchToTexts("@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n").complete, false);
  });
});
