import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKillTaskCommand,
  buildListTasksCommand,
  normalizeBackgroundTasks,
} from "@/lib/backgroundTasks";

describe("backgroundTasks", () => {
  it("normalizes terminal-like rows", () => {
    const tasks = normalizeBackgroundTasks([
      { terminalId: "t1", command: "npm test", status: "running" },
      { id: "t2", title: "dev", status: "completed", exitCode: 0 },
    ]);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]?.status, "running");
    assert.equal(tasks[1]?.status, "completed");
  });

  it("builds kill/list commands", () => {
    assert.equal(buildKillTaskCommand("t1"), "/tasks kill t1");
    assert.equal(buildListTasksCommand(), "/tasks");
  });
});
