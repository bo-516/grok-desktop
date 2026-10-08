/**
 * Typed git cli calls + normalizers: request shape, payload coercion and
 * verbatim error propagation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchGitDiff,
  fetchGitPrPreflight,
  fetchGitStatus,
  runGitCommit,
  runGitPrCreate,
  runGitPush,
  type GitCliRunner,
} from "@/lib/gitBridge";
import { normalizeGitDiff, normalizeGitStatus } from "@/lib/gitNormalize";

/**
 * Runner that records calls and answers from a table.
 * @param answers command → reply.
 */
function recordingRunner(answers: Record<string, { ok: boolean; data?: unknown; error?: string }>) {
  const calls: Array<{ command: string; args: unknown; cwd: string }> = [];
  const run: GitCliRunner = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return answers[command] ?? { ok: false, error: "unexpected" };
  };
  return { run, calls };
}

describe("git normalizers", () => {
  it("coerces malformed status payloads to not-a-repo", () => {
    const s = normalizeGitStatus("nope");
    assert.equal(s.isRepo, false);
    assert.deepEqual(s.files, []);
  });

  it("drops rows without a path and unknown kinds become unknown", () => {
    const s = normalizeGitStatus({
      isRepo: true,
      branch: "main",
      ahead: -3,
      files: [{ path: "a", kind: "modified" }, { kind: "added" }, { path: "b", kind: "weird" }],
    });
    assert.equal(s.ahead, 0);
    assert.deepEqual(s.files.map((f) => [f.path, f.kind]), [["a", "modified"], ["b", "unknown"]]);
  });

  it("normalizes diff rows with defaults", () => {
    const d = normalizeGitDiff({ isRepo: true, mode: "merge-base", base: "main", files: [{ path: "x", status: "added", untracked: true, added: 2 }] });
    assert.equal(d.mode, "merge-base");
    assert.deepEqual(d.files[0], { path: "x", status: "added", untracked: true, added: 2, removed: 0, binary: false, patch: "", tooLarge: false, omitted: false });
  });
});

describe("git cli calls", () => {
  it("passes cwd and args, and returns normalized data", async () => {
    const { run, calls } = recordingRunner({
      git_status: { ok: true, data: { isRepo: true, branch: "main", files: [] } },
      git_diff: { ok: true, data: { isRepo: true, files: [] } },
      git_commit: { ok: true, data: { commit: "abc", summary: "msg" } },
      git_push: { ok: true, data: { remote: "origin", branch: "main", upstream: "origin/main", setUpstream: true } },
      git_pr_preflight: { ok: true, data: { ghAvailable: true, bases: ["main", 3] } },
      git_pr_create: { ok: true, data: { url: "https://github.com/o/r/pull/1" } },
    });
    assert.equal((await fetchGitStatus(run, "/w")).branch, "main");
    await fetchGitDiff(run, "/w", { mode: "head", paths: ["a"] });
    await fetchGitDiff(run, "/w", { mode: "merge-base", base: "main" });
    assert.equal((await runGitCommit(run, "/w", { message: "m", paths: ["a"] })).commit, "abc");
    assert.equal((await runGitPush(run, "/w")).setUpstream, true);
    assert.deepEqual((await fetchGitPrPreflight(run, "/w")).bases, ["main"]);
    assert.equal((await runGitPrCreate(run, "/w", { title: "t", body: "", base: "main", draft: true })).url, "https://github.com/o/r/pull/1");
    assert.deepEqual(calls[1], { command: "git_diff", args: { mode: "head", paths: ["a"] }, cwd: "/w" });
    assert.deepEqual(calls[2]?.args, { mode: "merge-base", base: "main" });
    assert.ok(calls.every((c) => c.cwd === "/w"));
  });

  it("throws the bridge error verbatim", async () => {
    const { run } = recordingRunner({ git_push: { ok: false, error: "remote: Permission denied\n" } });
    await assert.rejects(runGitPush(run, "/w"), /^Error: remote: Permission denied$/);
  });
});
