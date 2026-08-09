import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertFileMentions } from "@/lib/composerDrop";
import { MENTION_AT_MARK } from "@/lib/mentionTokens";

describe("composerDrop", () => {
  it("inserts zero-width-marked file mentions at end", () => {
    const r = insertFileMentions("hello", ["src/a.ts", "b c.ts"]);
    assert.match(r.text, new RegExp(`${MENTION_AT_MARK}src\\/a\\.ts`));
    assert.match(r.text, new RegExp(`${MENTION_AT_MARK}"b c\\.ts"`));
  });

  it("inserts at caret with spacing", () => {
    const r = insertFileMentions("ab", ["x"], 1);
    assert.equal(r.text, `a ${MENTION_AT_MARK}x b`);
  });
});
