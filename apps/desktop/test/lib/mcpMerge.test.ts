/**
 * Unit tests for mergeMcpRows — D3 plugin-only case, config-only inactive,
 * doctor ignore/merge, env masking at the model boundary.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  mergeMcpRows,
  mcpStatusKind,
  normalizeInspect,
  type McpRow,
} from "@/lib/inspectModel";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

/**
 * Load a JSON fixture relative to test/fixtures.
 * @param name File name under fixtures/.
 */
function loadFixture(name: string): unknown {
  const text = readFileSync(join(fixturesDir, name), "utf8");
  return JSON.parse(text) as unknown;
}

describe("mergeMcpRows", () => {
  it("D3 case: inspect has plugin MCP, mcp list is [] ⇒ one plugin row", () => {
    const snap = normalizeInspect(loadFixture("inspect.json"));
    const emptyList = loadFixture("mcp-list-empty.json");
    const merged = mergeMcpRows(snap.mcpServers, emptyList);
    assert.equal(merged.length, 1);
    const row = merged[0]!;
    assert.equal(row.name, "browser-use");
    assert.equal(row.source.kind, "plugin");
    assert.equal(row.source.pluginName, "browser-use");
    assert.equal(row.inactive, undefined);
    assert.equal(mcpStatusKind(row), "unchecked");
  });

  it("keeps config-only server as inactive", () => {
    const inspectServers: McpRow[] = [];
    const config = loadFixture("mcp-list-config-only.json");
    const merged = mergeMcpRows(inspectServers, config);
    assert.equal(merged.length, 1);
    const row = merged[0]!;
    assert.equal(row.name, "local-fs");
    assert.equal(row.inactive, true);
    assert.equal(row.enabled, true);
    assert.equal(row.scope, "project");
    // Env values must not enter the model — keys only.
    assert.deepEqual(row.envKeys, ["API_KEY", "DEBUG"]);
    assert.deepEqual(row.headerNames, ["Authorization"]);
    assert.equal(mcpStatusKind(row), "disabled");
    // Guard: secret substrings must not appear on the row.
    const serialized = JSON.stringify(row);
    assert.doesNotMatch(serialized, /secret-should-not-leak|Bearer secret/);
  });

  it("ignores doctor for a name not in either list", () => {
    const inspectServers: McpRow[] = [
      {
        name: "browser-use",
        transport: "stdio",
        target: "uvx",
        source: { kind: "plugin", pluginName: "browser-use" },
      },
    ];
    const doctor = {
      servers: [
        {
          name: "ghost-server",
          healthy: false,
          checks: [{ label: "x", passed: false, detail: "" }],
        },
      ],
    };
    const merged = mergeMcpRows(inspectServers, [], doctor);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.name, "browser-use");
    assert.equal(merged[0]?.health, undefined);
  });

  it("merges doctor healthy onto the matching row only", () => {
    const snap = normalizeInspect(loadFixture("inspect.json"));
    const doctor = loadFixture("mcp-doctor-browser-use.json");
    const merged = mergeMcpRows(
      snap.mcpServers,
      loadFixture("mcp-list-empty.json"),
      doctor,
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.health?.healthy, true);
    assert.equal(mcpStatusKind(merged[0]!), "healthy");
    assert.ok((merged[0]?.health?.checks.length ?? 0) > 0);
  });

  it("overlays config enabled/scope onto inspect provenance", () => {
    const inspectServers: McpRow[] = [
      {
        name: "local-fs",
        transport: "stdio",
        target: "npx",
        source: { kind: "project", path: "/home/u/proj/.grok/config.toml" },
      },
    ];
    const config = loadFixture("mcp-list-config-only.json");
    const merged = mergeMcpRows(inspectServers, config);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.source.kind, "project");
    assert.equal(merged[0]?.enabled, true);
    assert.equal(merged[0]?.scope, "project");
    assert.equal(merged[0]?.inactive, undefined);
  });
});
