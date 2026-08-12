import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commandsToPaletteItems,
  defaultPaletteActions,
  filterPaletteItems,
  sessionsToPaletteItems,
} from "@/lib/commandPalette";

describe("commandPalette", () => {
  it("filters by substring and ranks prefix first", () => {
    const items = [
      ...defaultPaletteActions(),
      ...commandsToPaletteItems([
        { name: "compact", description: "Compress" },
        { name: "context", description: "Usage" },
      ]),
      ...sessionsToPaletteItems([{ id: "abc", title: "Fix bug" }]),
    ];
    const hits = filterPaletteItems(items, "comp");
    assert.ok(hits.some((h) => h.runValue === "compact"));
    assert.ok(!hits.some((h) => h.runValue === "context"));
  });

  it("includes sessions and settings", () => {
    const items = [
      ...sessionsToPaletteItems([{ id: "s1", title: "Hello" }]),
      ...defaultPaletteActions(),
    ];
    const hits = filterPaletteItems(items, "hello");
    assert.equal(hits[0]?.kind, "session");
  });

  it("exposes open_agents and no longer open_tasks", () => {
    const actions = defaultPaletteActions();
    assert.ok(actions.some((a) => a.runValue === "open_agents"));
    assert.ok(!actions.some((a) => a.runValue === "open_tasks"));
  });

  it("exposes Environment plus MCP/Skills/Plugins page openers", () => {
    const actions = defaultPaletteActions();
    assert.ok(actions.some((a) => a.runValue === "open_environment"));
    assert.ok(actions.some((a) => a.runValue === "open_env_mcp"));
    assert.ok(actions.some((a) => a.runValue === "open_env_skills"));
    assert.ok(actions.some((a) => a.runValue === "open_env_plugins"));
    assert.ok(!actions.some((a) => a.runValue === "open_extensions"));
  });
});
