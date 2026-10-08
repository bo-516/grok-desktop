/**
 * Worktree-chat pure helpers: path keys, start request, dirty refusal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWorktreeRequest,
  canonicalProjectPath,
  formatWorktreeIndicator,
  parseWorkspaceGit,
  projectGroupKey,
  projectPrefsKey,
  worktreeRemovalDecision,
  worktreeRemovePrompt,
  worktreeRmSucceeded,
  worktreeTokenError,
} from "@/lib/worktreeChat";

/** Clean `workspace_git` payload for a linked worktree. */
const cleanWorktree = {
  isRepo: true,
  branch: "feat",
  toplevel: "/tmp/wt",
  sourceRepo: "/proj/demo",
  dirty: false,
  worktree: true,
  worktreeId: "wt-1",
  worktreeName: "task",
  worktreePath: "/tmp/wt",
};

describe("worktree chat helpers", () => {
  it("canonicalizes only macOS /tmp and /var", () => {
    assert.equal(canonicalProjectPath("/tmp"), "/private/tmp");
    assert.equal(canonicalProjectPath("/tmp/wt"), "/private/tmp/wt");
    assert.equal(canonicalProjectPath("/var/folders/x"), "/private/var/folders/x");
    assert.equal(canonicalProjectPath("/private/tmp/wt"), "/private/tmp/wt");
    assert.equal(
      canonicalProjectPath("/Users/me/proj"),
      "/Users/me/proj",
    );
    assert.equal(canonicalProjectPath(""), "");
  });

  it("shares a prefs key when the path only differs by a trailing slash", () => {
    assert.equal(projectPrefsKey("/proj/demo/"), projectPrefsKey("/proj/demo"));
    assert.equal(projectPrefsKey("/"), "/");
    assert.equal(projectPrefsKey("  "), "");
  });

  it("formats a rail chip from name and branch", () => {
    assert.equal(formatWorktreeIndicator(undefined), "");
    assert.equal(formatWorktreeIndicator({ branch: "feat" }), "feat");
    assert.equal(formatWorktreeIndicator({ name: "task" }), "task");
    assert.equal(
      formatWorktreeIndicator({ name: "task", branch: "feat" }),
      "task · feat",
    );
    assert.equal(
      formatWorktreeIndicator({ name: "feat", branch: "feat" }),
      "feat",
    );
  });

  it("groups a worktree under its source repo", () => {
    assert.equal(
      projectGroupKey("/tmp/wt", "/proj/demo"),
      "/proj/demo",
    );
    assert.equal(
      projectGroupKey("/tmp/wt", "/tmp/repo"),
      "/private/tmp/repo",
    );
    assert.equal(projectGroupKey("/Users/me/proj"), "/Users/me/proj");
    assert.equal(projectGroupKey("", ""), "");
  });

  it("rejects flag-like and multi-line tokens and omits blanks", () => {
    assert.equal(worktreeTokenError("Name", ""), "");
    assert.equal(worktreeTokenError("Name", "  "), "");
    assert.equal(
      worktreeTokenError("Name", "-f"),
      'Name must not start with "-"',
    );
    assert.equal(
      worktreeTokenError("Base ref", "a\nb"),
      "Base ref must be a single line",
    );
    assert.deepEqual(buildWorktreeRequest("  ", " "), {});
    assert.deepEqual(buildWorktreeRequest(" task ", " main "), {
      name: "task",
      ref: "main",
    });
  });

  it("parses workspace_git and refuses a dirty or unknown tree", () => {
    assert.equal(parseWorkspaceGit(null), null);
    assert.equal(parseWorkspaceGit({ branch: "main" }), null);
    const notRepo = parseWorkspaceGit({ isRepo: false });
    assert.equal(notRepo?.isRepo, false);
    assert.equal(notRepo?.dirty, false);
    const parsed = parseWorkspaceGit(cleanWorktree);
    assert.equal(parsed?.worktreeId, "wt-1");
    assert.equal(parsed?.dirty, false);

    const clean = worktreeRemovalDecision({ ok: true, data: cleanWorktree });
    assert.equal(clean.blocked, false);
    assert.equal(clean.reason, "");
    const dirty = worktreeRemovalDecision({
      ok: true,
      data: { ...cleanWorktree, dirty: true },
    });
    assert.equal(dirty.blocked, true);
    assert.match(dirty.reason, /uncommitted changes/);
    const missing = worktreeRemovalDecision({
      ok: true,
      data: { isRepo: false },
    });
    assert.equal(missing.blocked, true);
    assert.match(missing.reason, /not a git checkout/);
    const failed = worktreeRemovalDecision({ ok: false });
    assert.equal(failed.blocked, true);
    assert.match(failed.reason, /Could not check/);
  });

  it("uses the refusal reason when removal is blocked", () => {
    const clean = worktreeRemovePrompt("/tmp/wt-1", false, "");
    assert.equal(clean.title, "Remove worktree?");
    assert.equal(clean.subject, "/tmp/wt-1");
    assert.match(clean.details.join(" "), /deleted/);
    const blocked = worktreeRemovePrompt("/tmp/wt-1", true, "dirty tree");
    assert.equal(blocked.title, "Remove worktree?");
    assert.deepEqual(blocked.details, ["dirty tree"]);
    assert.equal(blocked.cancelLabel, "Close");
  });

  it("treats only exit code 0 as a removed worktree", () => {
    assert.equal(worktreeRmSucceeded({ ok: true, data: { code: 0 } }), true);
    assert.equal(worktreeRmSucceeded({ ok: true, data: { code: 1 } }), false);
    assert.equal(worktreeRmSucceeded({ ok: false, data: { code: 0 } }), false);
    assert.equal(worktreeRmSucceeded({ ok: true }), false);
    assert.equal(worktreeRmSucceeded({ ok: true, data: {} }), false);
  });
});
