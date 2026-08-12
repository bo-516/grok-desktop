/**
 * Unit tests for normalizeInspect / normalizeDoctorHealth / source helpers.
 * Fixtures are sanitized captures of `grok inspect --json` and doctor output.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  maskSecret,
  mergeMcpRows,
  normalizeDoctorHealth,
  normalizeInspect,
  normalizeSource,
  sourceChipLabel,
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

describe("normalizeInspect", () => {
  it("round-trips the real sanitized inspect fixture", () => {
    const raw = loadFixture("inspect.json");
    const snap = normalizeInspect(raw);
    assert.equal(snap.skills.length, 23);
    assert.equal(snap.agents.length, 3);
    assert.equal(snap.plugins.length, 1);
    assert.equal(snap.mcpServers.length, 1);
    assert.equal(snap.compat.length, 13);
    assert.equal(snap.warnings.length, 1);
    assert.equal(snap.projectTrusted, true);
    assert.ok(snap.grokVersion.length > 0);
    assert.equal(snap.mcpServers[0]?.name, "browser-use");
    assert.equal(snap.mcpServers[0]?.source.kind, "plugin");
    assert.equal(snap.mcpServers[0]?.source.pluginName, "browser-use");
    // No snake_case keys leaked onto the model surface.
    assert.equal(
      (snap.mcpServers[0]?.source as { plugin_name?: string }).plugin_name,
      undefined,
    );
    // Paths are sanitized in the fixture.
    assert.ok(snap.mcpServers[0]?.source.path?.startsWith("/home/u"));
    const pluginSkill = snap.skills.find((s) => s.name === "browser-use");
    assert.ok(pluginSkill);
    assert.equal(pluginSkill?.source.kind, "plugin");
    assert.equal(pluginSkill?.userInvocable, true);
    assert.equal(snap.rawFallback, undefined);
  });

  it("accepts { raw } text fallback without throwing", () => {
    const snap = normalizeInspect({ raw: "inspect failed: not json" });
    assert.equal(snap.rawFallback, "inspect failed: not json");
    assert.deepEqual(snap.skills, []);
    assert.deepEqual(snap.mcpServers, []);
    assert.deepEqual(snap.agents, []);
    assert.deepEqual(snap.plugins, []);
    assert.deepEqual(snap.compat, []);
  });

  it("degrades null / undefined / bad fields to empty arrays", () => {
    assert.deepEqual(normalizeInspect(null).skills, []);
    assert.deepEqual(normalizeInspect(undefined).skills, []);
    assert.deepEqual(normalizeInspect([]).skills, []);
    const bad = normalizeInspect({
      skills: "nope",
      agents: null,
      mcpServers: 42,
      plugins: {},
      projectTrusted: "yes",
    });
    assert.deepEqual(bad.skills, []);
    assert.deepEqual(bad.agents, []);
    assert.deepEqual(bad.mcpServers, []);
    assert.deepEqual(bad.plugins, []);
    assert.equal(bad.projectTrusted, false);
  });

  it("maps unknown source.type to unknown and keeps path", () => {
    const snap = normalizeInspect({
      skills: [
        {
          name: "x",
          description: "d",
          source: { type: "future-kind", path: "/home/u/x" },
          userInvocable: false,
        },
      ],
    });
    assert.equal(snap.skills[0]?.source.kind, "unknown");
    assert.equal(snap.skills[0]?.source.path, "/home/u/x");
  });

  it("normalizeSource accepts plugin_name snake_case", () => {
    const src = normalizeSource({
      type: "plugin",
      plugin_name: "browser-use",
      path: "/home/u/p",
    });
    assert.equal(src.kind, "plugin");
    assert.equal(src.pluginName, "browser-use");
    assert.equal(sourceChipLabel(src), "plugin: browser-use");
  });

  it("maskSecret never returns the original secret", () => {
    assert.equal(maskSecret("super-secret"), "••••");
    assert.equal(maskSecret(""), "");
  });
});

describe("normalizeDoctorHealth", () => {
  it("maps snake_case doctor keys onto the model", () => {
    const doctor = loadFixture("mcp-doctor-browser-use.json");
    const map = normalizeDoctorHealth(doctor);
    const health = map["browser-use"];
    assert.ok(health);
    assert.equal(health.healthy, true);
    assert.ok(health.checks.length >= 1);
    assert.ok(health.checks.every((c) => typeof c.passed === "boolean"));
    assert.match(health.summary, /checks passed/);
    // Ensure snake_case aggregate keys were read (fixture has healthy_count).
    const root = doctor as { healthy_count: number; failing_count: number };
    assert.equal(root.healthy_count, 1);
    assert.equal(root.failing_count, 0);
  });
});

describe("mergeMcpRows (smoke via inspect model)", () => {
  it("D3: plugin server from inspect survives empty mcp list", () => {
    const snap = normalizeInspect(loadFixture("inspect.json"));
    const merged = mergeMcpRows(snap.mcpServers, loadFixture("mcp-list-empty.json"));
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.name, "browser-use");
    assert.equal(merged[0]?.source.kind, "plugin");
    assert.equal(merged[0]?.source.pluginName, "browser-use");
  });
});
