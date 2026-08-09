/**
 * disposeAgentProcess: ensure the agent process group (including simulated MCP children) is cleared with SIGTERM.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { describe, it } from "node:test";
import { disposeAgentProcess } from "./spawnGrok.js";

/**
 * Start a short-lived process tree via shell: parent shell spawns a sleep child, simulating grok + MCP.
 * @returns Root child and a helper to query child pids.
 */
function spawnSleepTree(): {
  root: ChildProcessWithoutNullStreams;
  childPid: () => number | null;
} {
  // Root is process-group leader; child sleep inherits the group.
  const root = spawn(
    "bash",
    ["-c", "sleep 60 & echo $!; wait"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  ) as ChildProcessWithoutNullStreams;

  let nestedPid: number | null = null;
  root.stdout.on("data", (buf: Buffer) => {
    const n = Number(buf.toString("utf8").trim().split("\n")[0]);
    if (Number.isFinite(n) && n > 0) {
      nestedPid = n;
    }
  });

  return {
    root,
    childPid: () => nestedPid,
  };
}

/**
 * process.kill(pid, 0) succeeding means the process is still alive.
 * @param pid Target pid.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("disposeAgentProcess", () => {
  it("SIGTERM process group reaps root and nested child", async () => {
    const { root, childPid } = spawnSleepTree();
    assert.ok(root.pid, "root pid");

    // Wait until nested sleep pid is printed.
    const deadline = Date.now() + 3_000;
    while (childPid() == null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const nested = childPid();
    assert.ok(nested, "nested sleep pid should be known");
    assert.equal(isAlive(root.pid!), true);
    assert.equal(isAlive(nested!), true);

    disposeAgentProcess(root, true, 500);

    await once(root, "close");
    // Allow kernel to reap nested.
    const end = Date.now() + 2_000;
    while ((isAlive(root.pid!) || isAlive(nested!)) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(isAlive(root.pid!), false, "root should be dead");
    assert.equal(isAlive(nested!), false, "nested MCP stand-in should be dead");
  });
});
