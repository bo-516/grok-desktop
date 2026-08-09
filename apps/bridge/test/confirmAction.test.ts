/**
 * J-05 irreversible confirm helpers — unit tests drive shipped builders.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfirmPrompt,
  requiresSecondaryConfirm,
} from "../src/confirmAction.js";

describe("confirmAction", () => {
  it("marks delete/rewind/worktree/memory/share as requiring secondary confirm", () => {
    assert.equal(requiresSecondaryConfirm("session_delete"), true);
    assert.equal(requiresSecondaryConfirm("rewind"), true);
    assert.equal(requiresSecondaryConfirm("worktree_rm"), true);
    assert.equal(requiresSecondaryConfirm("memory_clear"), true);
    assert.equal(requiresSecondaryConfirm("share_upload"), true);
    assert.equal(requiresSecondaryConfirm("export"), false);
  });

  it("warns about uncommitted git on rewind", () => {
    const p = buildConfirmPrompt("rewind", { dirtyGit: true });
    assert.match(p.details.join(" "), /Uncommitted git/);
  });

  it("mentions upload host on share", () => {
    const p = buildConfirmPrompt("share_upload", {
      uploadHost: "code.grok.com",
    });
    assert.match(p.details.join(" "), /code\.grok\.com/);
  });
});
