/**
 * Unit tests for session fork param builders and result parsers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSessionForkParams,
  parseSessionForkResult,
} from "../src/sessionFork.js";

describe("buildSessionForkParams", () => {
  it("requires sourceSessionId and sourceCwd", () => {
    assert.equal(
      buildSessionForkParams({ sourceSessionId: "", sourceCwd: "/tmp" }),
      null,
    );
    assert.equal(
      buildSessionForkParams({ sourceSessionId: "abc", sourceCwd: "  " }),
      null,
    );
  });

  it("defaults newCwd to sourceCwd", () => {
    const p = buildSessionForkParams({
      sourceSessionId: " sid ",
      sourceCwd: " /work ",
    });
    assert.deepEqual(p, {
      sourceSessionId: "sid",
      sourceCwd: "/work",
      newCwd: "/work",
    });
  });

  it("accepts an explicit child cwd", () => {
    const p = buildSessionForkParams(
      { sourceSessionId: "a", sourceCwd: "/src" },
      "/wt",
    );
    assert.equal(p?.newCwd, "/wt");
  });
});

describe("parseSessionForkResult", () => {
  it("reads camelCase agent payload", () => {
    const r = parseSessionForkResult({
      newSessionId: "child-1",
      chatMessagesCopied: 8,
      updatesCopied: 4,
      planStateCopied: false,
      newCwd: "/work",
      parentSessionId: "parent-1",
    });
    assert.equal(r?.newSessionId, "child-1");
    assert.equal(r?.chatMessagesCopied, 8);
    assert.equal(r?.parentSessionId, "parent-1");
  });

  it("accepts snake_case aliases", () => {
    const r = parseSessionForkResult({
      new_session_id: "child-2",
      parent_session_id: "p2",
      new_cwd: "/x",
    });
    assert.equal(r?.newSessionId, "child-2");
    assert.equal(r?.parentSessionId, "p2");
    assert.equal(r?.newCwd, "/x");
  });

  it("returns null without a child id", () => {
    assert.equal(parseSessionForkResult({}), null);
    assert.equal(parseSessionForkResult(null), null);
    assert.equal(parseSessionForkResult("x"), null);
  });
});
