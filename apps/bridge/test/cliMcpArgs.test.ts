/**
 * Pure argv builders for MCP enable/disable/add (env/headers passthrough).
 * Asserts flag placement without spawning `grok`.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildMcpAddHttpArgs,
  buildMcpAddStdioArgs,
  buildMcpToggleArgs,
} from "../src/cliCommands.js";

const bridgeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("buildMcpToggleArgs", () => {
  it("builds enable/disable argv without --scope", () => {
    assert.deepEqual(buildMcpToggleArgs("enable", "browser-use"), [
      "mcp",
      "enable",
      "browser-use",
    ]);
    assert.deepEqual(buildMcpToggleArgs("disable", "local-fs"), [
      "mcp",
      "disable",
      "local-fs",
    ]);
    assert.ok(!buildMcpToggleArgs("enable", "x").includes("--scope"));
  });
});

describe("buildMcpAddStdioArgs", () => {
  it("repeats -e for each env entry and places command after env", () => {
    const args = buildMcpAddStdioArgs({
      name: "postgres",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: ["DATABASE_URL=postgres://localhost/db", "DEBUG=1"],
      scope: "project",
    });
    assert.deepEqual(args, [
      "mcp",
      "add",
      "postgres",
      "-e",
      "DATABASE_URL=postgres://localhost/db",
      "-e",
      "DEBUG=1",
      "npx",
      "--",
      "-y",
      "@modelcontextprotocol/server-postgres",
      "--scope",
      "project",
    ]);
  });

  it("omits -e and --scope user (default) when not project", () => {
    const args = buildMcpAddStdioArgs({
      name: "xcode",
      command: "xcrun",
      args: ["mcpbridge"],
    });
    assert.deepEqual(args, [
      "mcp",
      "add",
      "xcode",
      "xcrun",
      "--",
      "mcpbridge",
    ]);
  });
});

describe("buildMcpAddHttpArgs", () => {
  it("repeats -H for each header and accepts sse transport", () => {
    const args = buildMcpAddHttpArgs({
      name: "sentry",
      url: "https://mcp.sentry.dev/mcp",
      headers: ["Authorization: Bearer tok", "X-Debug: 1"],
      transport: "sse",
      scope: "project",
    });
    assert.deepEqual(args, [
      "mcp",
      "add",
      "sentry",
      "--transport",
      "sse",
      "https://mcp.sentry.dev/mcp",
      "-H",
      "Authorization: Bearer tok",
      "-H",
      "X-Debug: 1",
      "--scope",
      "project",
    ]);
  });

  it("defaults transport to http", () => {
    const args = buildMcpAddHttpArgs({
      name: "remote",
      url: "https://example.invalid/mcp",
    });
    assert.ok(args.includes("--transport"));
    assert.equal(args[args.indexOf("--transport") + 1], "http");
  });
});

describe("hooks trust CLI removal", () => {
  it("bridge src has zero hooksTrust / hooks trust dispatch remnants", () => {
    const srcRoot = join(bridgeRoot, "src");
    const hits: string[] = [];
    const stack = [srcRoot];
    // Match the removed command id and function without using those literals
    // concatenated in this file (so the scan of test/ can stay clean later).
    const needleA = ["hooks", "trust"].join("_");
    const needleB = ["hooks", "Trust"].join("");
    while (stack.length) {
      const dir = stack.pop()!;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
          continue;
        }
        if (!/\.(ts|js)$/.test(ent.name)) {
          continue;
        }
        const text = readFileSync(p, "utf8");
        if (text.includes(needleA) || text.includes(needleB)) {
          hits.push(p);
        }
      }
    }
    assert.deepEqual(hits, [], `unexpected trust CLI refs: ${hits.join(", ")}`);
  });
});
