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

  it("A-01: rules appear as --rules before agent (global flag position)", () => {
    const extra = buildSpawnExtraArgs({ rules: "be brief" }, false);
    const args = buildGrokAgentArgs({ cwd: "/tmp", extraArgs: extra });
    const rulesIdx = args.indexOf("--rules");
    const agentIdx = args.indexOf("agent");
    assert.ok(rulesIdx >= 0, "missing --rules");
    assert.equal(args[rulesIdx + 1], "be brief");
    assert.ok(rulesIdx < agentIdx, "--rules must be global (before agent)");
  });

  it("A-02: empty / whitespace rules omit --rules", () => {
    for (const rules of ["", "   ", "\t"]) {
      const extra = buildSpawnExtraArgs({ rules }, false);
      assert.equal(extra.includes("--rules"), false, `rules=${JSON.stringify(rules)}`);
    }
  });

  it("A-03: rules with newline/quotes/CJK stay one argv element", () => {
    const text = 'line1\n"quoted" 中文';
    const extra = buildSpawnExtraArgs({ rules: text }, false);
    const args = buildGrokAgentArgs({ cwd: "/tmp", extraArgs: extra });
    const rulesIdx = args.indexOf("--rules");
    assert.ok(rulesIdx >= 0);
    assert.equal(args[rulesIdx + 1], text);
    // Not split across multiple argv slots.
    assert.equal(args.filter((a) => a === text).length, 1);
  });
});
