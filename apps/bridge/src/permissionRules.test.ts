/**
 * TC-PERM-07 style: deny beats allow.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePermissionRules,
  matchPermissionRule,
  permissionRulesToSpawnArgs,
} from "./permissionRules.js";

describe("permissionRules", () => {
  it("deny wins over allow for Bash(rm -rf *)", () => {
    const rules = [
      { pattern: "Bash(*)", effect: "allow" as const },
      { pattern: "Bash(rm -rf *)", effect: "deny" as const },
    ];
    assert.equal(
      evaluatePermissionRules(rules, "bash", "rm -rf /tmp/x"),
      "deny",
    );
    assert.equal(evaluatePermissionRules(rules, "bash", "ls"), "allow");
  });

  it("matches Read(src/**)", () => {
    assert.equal(
      matchPermissionRule("Read(src/**)", "read", "src/a/b.ts"),
      true,
    );
  });

  it("builds spawn --allow/--deny args", () => {
    const args = permissionRulesToSpawnArgs([
      { pattern: "Bash(git *)", effect: "allow" },
      { pattern: "Bash(rm *)", effect: "deny" },
    ]);
    assert.deepEqual(args, [
      "--allow",
      "Bash(git *)",
      "--deny",
      "Bash(rm *)",
    ]);
  });
});
