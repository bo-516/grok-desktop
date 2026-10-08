/**
 * Git status store: per-cwd entries, coalesced refreshes (one in flight +
 * one trailing re-run) and error retention.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { GitCliRunner } from "@/lib/gitBridge";
import { getGitEntry, useGitStore } from "@/store/gitStore";

beforeEach(() => {
  useGitStore.setState({ byCwd: {} });
});

/**
 * Runner whose replies resolve only when released, counting calls.
 * @param branchFor Branch name per call index.
 */
function gatedRunner(branchFor: (n: number) => string) {
  const state = { calls: 0, release: [] as Array<() => void> };
  const run: GitCliRunner = (_command, _args, _cwd) => {
    const n = state.calls;
    state.calls += 1;
    return new Promise((resolve) => {
      state.release.push(() => resolve({ ok: true, data: { isRepo: true, branch: branchFor(n), files: [] } }));
    });
  };
  return { run, state };
}

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("gitStore.refreshStatus", () => {
  it("stores the snapshot per cwd", async () => {
    const { run, state } = gatedRunner(() => "main");
    const job = useGitStore.getState().refreshStatus("/a", run);
    assert.equal(getGitEntry("/a").loading, true);
    state.release[0]?.();
    await job;
    assert.equal(getGitEntry("/a").status?.branch, "main");
    assert.ok(getGitEntry("/a").updatedAt > 0);
    assert.equal(getGitEntry("/b").status, null);
  });

  it("coalesces concurrent calls into one trailing re-run", async () => {
    const { run, state } = gatedRunner((n) => `b${n}`);
    const first = useGitStore.getState().refreshStatus("/a", run);
    void useGitStore.getState().refreshStatus("/a", run);
    void useGitStore.getState().refreshStatus("/a", run);
    state.release[0]?.();
    await flush();
    assert.equal(state.calls, 2);
    state.release[1]?.();
    await first;
    assert.equal(state.calls, 2);
    assert.equal(getGitEntry("/a").status?.branch, "b1");
  });

  it("keeps the last snapshot and records the error on failure", async () => {
    const ok = gatedRunner(() => "main");
    const job = useGitStore.getState().refreshStatus("/a", ok.run);
    ok.state.release[0]?.();
    await job;
    await useGitStore.getState().refreshStatus("/a", async () => ({ ok: false, error: "git is not installed" }));
    assert.equal(getGitEntry("/a").status?.branch, "main");
    assert.equal(getGitEntry("/a").error, "git is not installed");
    assert.equal(getGitEntry("/a").loading, false);
  });

  it("ignores an empty cwd", async () => {
    await useGitStore.getState().refreshStatus("", async () => ({ ok: true, data: {} }));
    assert.deepEqual(useGitStore.getState().byCwd, {});
  });
});
