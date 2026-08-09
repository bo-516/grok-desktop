import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForkCommand,
  buildRewindCommand,
  normalizeSessionsList,
  rewindConfirm,
  shareConfirm,
} from "./sessionActions.js";

describe("sessionActions", () => {
  it("builds fork/rewind commands", () => {
    assert.equal(buildForkCommand(), "/fork");
    assert.equal(buildForkCommand("from here"), "/fork from here");
    assert.equal(buildRewindCommand(), "/rewind");
  });

  it("warns dirty git on rewind confirm", () => {
    const p = rewindConfirm(true);
    assert.match(p.details.join(" "), /Uncommitted/);
  });

  it("share confirm mentions code.grok.com", () => {
    assert.match(shareConfirm().details.join(" "), /code\.grok\.com/);
  });

  it("normalizes sessions list array", () => {
    const rows = normalizeSessionsList([
      { id: "abc", title: "Hello" },
      { sessionId: "def", name: "X" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, "abc");
  });
});
