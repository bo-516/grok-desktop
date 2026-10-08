/**
 * Pending worktree start slot. Peek must not clear, so a failed create
 * can be retried while the composer option is still mounted.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clearPendingWorktreeStart,
  peekPendingWorktreeStart,
  setPendingWorktreeStart,
} from "@/lib/worktreeChatPending";

describe("pending worktree start", { concurrency: 1 }, () => {
  afterEach(() => {
    clearPendingWorktreeStart();
  });

  it("returns an empty object as a real create and undefined when off", () => {
    assert.equal(peekPendingWorktreeStart(), undefined);
    setPendingWorktreeStart({});
    assert.deepEqual(peekPendingWorktreeStart(), {});
    // A second peek still sees the request — start does not consume it.
    assert.deepEqual(peekPendingWorktreeStart(), {});
    setPendingWorktreeStart({ name: "task", ref: "main" });
    assert.deepEqual(peekPendingWorktreeStart(), { name: "task", ref: "main" });
    setPendingWorktreeStart(null);
    assert.equal(peekPendingWorktreeStart(), undefined);
    setPendingWorktreeStart({ name: "task" });
    clearPendingWorktreeStart();
    assert.equal(peekPendingWorktreeStart(), undefined);
  });
});
