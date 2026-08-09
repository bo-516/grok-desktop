/**
 * Spawn argv builder tests (TC-OPS-05 / F-CFG-06 / SPAWN flag placement).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGrokAgentArgs } from "../src/spawnGrok.js";
import { buildSpawnExtraArgs } from "../src/sessionRuntime.js";

describe("buildGrokAgentArgs", () => {
  it("always places --no-auto-update before agent", () => {
    const args = buildGrokAgentArgs({ cwd: "/tmp" });
    assert.equal(args[0], "--no-auto-update");
    assert.ok(args.includes("agent"));
    assert.equal(args[args.length - 1], "stdio");
    assert.ok(args.indexOf("--no-auto-update") < args.indexOf("agent"));
  });

  it("places --always-approve on agent, sandbox on global", () => {
    const args = buildGrokAgentArgs({
      cwd: "/tmp",
      alwaysApprove: true,
      extraArgs: ["--sandbox", "workspace", "--model", "grok-build"],
    });
    assert.ok(args.indexOf("--sandbox") < args.indexOf("agent"));
    assert.ok(args.indexOf("--always-approve") > args.indexOf("agent"));
    assert.ok(args.indexOf("--model") > args.indexOf("agent"));
  });
});

describe("buildSpawnExtraArgs", () => {
  it("maps SPAWN config to CLI flags", () => {
    const args = buildSpawnExtraArgs(
      {
        model: "m1",
        sandbox: "read-only",
        worktree: "feat",
        noPlan: true,
        noSubagents: true,
        maxTurns: 5,
        rules: "be brief",
        disableWebSearch: true,
      },
      false,
    );
    assert.ok(args.includes("--model"));
    assert.ok(args.includes("m1"));
    assert.ok(args.includes("--sandbox"));
    assert.ok(args.includes("read-only"));
    assert.ok(args.includes("--worktree"));
    assert.ok(args.includes("feat"));
    assert.ok(args.includes("--no-plan"));
    assert.ok(args.includes("--no-subagents"));
    assert.ok(args.includes("--max-turns"));
    assert.ok(args.includes("5"));
  });
});
