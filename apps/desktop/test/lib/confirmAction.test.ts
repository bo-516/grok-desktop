/**
 * Confirm prompt copy + subject chip formatting (J-05).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfirmPrompt,
  formatConfirmSubject,
  requiresSecondaryConfirm,
} from "@/lib/confirmAction";

describe("confirmAction", () => {
  it("marks delete/rewind/worktree/memory/share as requiring secondary confirm", () => {
    assert.equal(requiresSecondaryConfirm("session_delete"), true);
    assert.equal(requiresSecondaryConfirm("rewind"), true);
    assert.equal(requiresSecondaryConfirm("worktree_rm"), true);
    assert.equal(requiresSecondaryConfirm("memory_clear"), true);
    assert.equal(requiresSecondaryConfirm("share_upload"), true);
    assert.equal(requiresSecondaryConfirm("export"), false);
  });

  it("keeps delete title short and parks the session name on subject", () => {
    const p = buildConfirmPrompt("session_delete", {
      label: "查会话信息性能缓慢问题分析```",
    });
    assert.equal(p.title, "Delete session?");
    assert.equal(p.subject, "查会话信息性能缓慢问题分析");
    assert.doesNotMatch(p.title, /查会话/);
    assert.equal(p.details.length, 1);
    assert.match(p.details[0] ?? "", /cannot be undone/);
  });

  it("omits subject when the delete label is empty", () => {
    const p = buildConfirmPrompt("session_delete", { label: "   " });
    assert.equal(p.title, "Delete session?");
    assert.equal(p.subject, undefined);
  });

  it("parks worktree path on subject", () => {
    const p = buildConfirmPrompt("worktree_rm", { label: "/tmp/wt-1" });
    assert.equal(p.title, "Remove worktree?");
    assert.equal(p.subject, "/tmp/wt-1");
  });

  it("warns about uncommitted git on rewind", () => {
    const p = buildConfirmPrompt("rewind", { dirtyGit: true });
    assert.match(p.details.join(" "), /Uncommitted git/);
    assert.equal(p.subject, undefined);
  });

  it("mentions upload host on share", () => {
    const p = buildConfirmPrompt("share_upload", {
      uploadHost: "code.grok.com",
    });
    assert.match(p.details.join(" "), /code\.grok\.com/);
  });

  it("strips wrapping quotes and leftover fence ticks from subjects", () => {
    assert.equal(formatConfirmSubject(undefined), "");
    assert.equal(formatConfirmSubject("  "), "");
    assert.equal(formatConfirmSubject("“hello”"), "hello");
    assert.equal(formatConfirmSubject('"quoted"'), "quoted");
    assert.equal(
      formatConfirmSubject("查会话信息性能缓慢问题分析```"),
      "查会话信息性能缓慢问题分析",
    );
    assert.equal(formatConfirmSubject("```draft title```"), "draft title");
  });
});
