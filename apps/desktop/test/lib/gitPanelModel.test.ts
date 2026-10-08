/**
 * Git chrome view-model: chip label, action gates + reasons, commit
 * selection, PR title prefill and refresh-trigger predicates.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commitPathsForSelection,
  defaultPrTitle,
  focusRefreshDue,
  gitActionGates,
  gitChipModel,
  isTurnSettleEdge,
  PR_TITLE_MAX,
} from "@/lib/gitPanelModel";
import type { GitStatus } from "@/lib/gitTypes";

/**
 * Repo snapshot with overrides.
 * @param patch Fields to override.
 */
function status(patch: Partial<GitStatus> = {}): GitStatus {
  return {
    isRepo: true,
    root: "/repo",
    branch: "feat",
    detached: false,
    head: "abcdef1234567890",
    initial: false,
    upstream: "origin/feat",
    ahead: 0,
    behind: 0,
    files: [{ path: "a.ts", index: ".", worktree: "M", kind: "modified" }],
    truncated: false,
    ...patch,
  };
}

const LIVE = { connected: true, busy: false };

describe("gitChipModel", () => {
  it("hides outside a repo and before the first load", () => {
    assert.equal(gitChipModel(null).visible, false);
    assert.equal(gitChipModel(status({ isRepo: false })).visible, false);
  });

  it("shows branch, dirty count and upstream drift", () => {
    const chip = gitChipModel(status({ ahead: 2, behind: 1 }));
    assert.equal(chip.branch, "feat");
    assert.equal(chip.dirty, 1);
    assert.match(chip.title, /1 changed file · ↑2 ↓1 vs origin\/feat/);
  });

  it("labels detached HEAD and unpublished branches", () => {
    assert.equal(gitChipModel(status({ detached: true, branch: "" })).branch, "detached @abcdef1");
    assert.match(gitChipModel(status({ upstream: "", files: [] })).title, /clean · not published/);
  });
});

describe("gitActionGates", () => {
  it("blocks everything without a bridge / repo / while busy", () => {
    assert.equal(gitActionGates(status(), { connected: false, busy: false }).commit.reason, "Bridge not connected");
    assert.equal(gitActionGates(null, LIVE).push.reason, "Loading git status…");
    assert.equal(gitActionGates(status({ isRepo: false }), LIVE).pr.reason, "Not a git repository");
    assert.equal(gitActionGates(status(), { connected: true, busy: true }).commit.enabled, false);
  });

  it("commit needs changes and no conflicts", () => {
    assert.equal(gitActionGates(status(), LIVE).commit.enabled, true);
    assert.equal(gitActionGates(status({ files: [] }), LIVE).commit.reason, "No changes to commit");
    const conflict = status({ files: [{ path: "c", index: "U", worktree: "U", kind: "conflicted" }] });
    assert.match(gitActionGates(conflict, LIVE).commit.reason, /conflicts/);
  });

  it("push publishes unpublished branches and idles when up to date", () => {
    const unpublished = gitActionGates(status({ upstream: "" }), LIVE);
    assert.equal(unpublished.pushLabel, "Publish");
    assert.equal(unpublished.push.enabled, true);
    assert.equal(gitActionGates(status(), LIVE).push.reason, "Up to date with origin/feat");
    assert.equal(gitActionGates(status({ ahead: 1 }), LIVE).push.enabled, true);
    assert.match(gitActionGates(status({ detached: true }), LIVE).push.reason, /detached/);
    assert.match(gitActionGates(status({ initial: true, upstream: "" }), LIVE).push.reason, /No commits/);
  });

  it("PR requires a published, fully pushed branch", () => {
    assert.equal(gitActionGates(status(), LIVE).pr.enabled, true);
    assert.match(gitActionGates(status({ upstream: "" }), LIVE).pr.reason, /Publish the branch/);
    assert.equal(gitActionGates(status({ ahead: 2 }), LIVE).pr.reason, "Push 2 unpushed commits first");
  });
});

describe("commitPathsForSelection", () => {
  it("adds rename sources and keeps file order", () => {
    const files = [
      { path: "b.ts" },
      { path: "new.ts", origPath: "old.ts" },
      { path: "c.ts" },
    ];
    assert.deepEqual(commitPathsForSelection(files, new Set(["new.ts", "b.ts"])), ["b.ts", "new.ts", "old.ts"]);
    assert.deepEqual(commitPathsForSelection(files, new Set()), []);
  });
});

describe("defaultPrTitle", () => {
  it("prefers a real session title and collapses whitespace", () => {
    assert.equal(defaultPrTitle("  Fix   login\nbug ", "feat"), "Fix login bug");
  });
  it("falls back to the branch for generic or empty titles", () => {
    assert.equal(defaultPrTitle("New chat", "feat/x"), "feat/x");
    assert.equal(defaultPrTitle("", "feat/x"), "feat/x");
  });
  it("caps long titles", () => {
    const t = defaultPrTitle("x".repeat(500), "b");
    assert.equal(t.length, PR_TITLE_MAX);
    assert.ok(t.endsWith("…"));
  });
});

describe("refresh triggers", () => {
  it("fires on a busy → idle edge only", () => {
    assert.equal(isTurnSettleEdge("streaming", "idle"), true);
    assert.equal(isTurnSettleEdge("waiting_permission", "disconnected"), true);
    assert.equal(isTurnSettleEdge("idle", "idle"), false);
    assert.equal(isTurnSettleEdge("idle", "streaming"), false);
    assert.equal(isTurnSettleEdge(null, "idle"), false);
  });
  it("throttles focus refreshes", () => {
    assert.equal(focusRefreshDue(0, 10_000), true);
    assert.equal(focusRefreshDue(10_000, 10_500), false);
    assert.equal(focusRefreshDue(10_000, 12_000), true);
  });
});
