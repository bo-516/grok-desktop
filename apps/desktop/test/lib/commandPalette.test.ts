import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaletteCatalog,
  commandsToPaletteItems,
  defaultPaletteActions,
  filterPaletteItems,
  mcpToPaletteItems,
  mergePaletteItems,
  paletteItemName,
  sessionsToPaletteItems,
  skillsToPaletteItems,
} from "@/lib/commandPalette";
import { GITHUB_OVERFLOW_PRETEXT } from "@/lib/overflowText";

describe("commandPalette", () => {
  it("filters by substring and ranks prefix first", () => {
    const items = [
      ...defaultPaletteActions(),
      ...commandsToPaletteItems([
        { name: "compact", description: "Compress" },
        { name: "context", description: "Usage" },
      ]),
    ];
    const hits = filterPaletteItems(items, "comp");
    assert.ok(hits.some((h) => h.runValue === "compact"));
    assert.ok(!hits.some((h) => h.runValue === "context"));
  });

  it("lists action / setting / command / mcp / skill and omits sessions", () => {
    const catalog = buildPaletteCatalog({
      commands: [{ name: "privacy", description: "Privacy" }],
      mcpServers: [
        {
          name: "browser-use",
          target: GITHUB_OVERFLOW_PRETEXT,
          transport: "http",
        },
      ],
      skills: [
        {
          name: "review",
          description: "Harsh maintainability review",
          userInvocable: true,
        },
      ],
    });
    const kinds = new Set(catalog.map((row) => row.kind));
    assert.ok(kinds.has("action"));
    assert.ok(kinds.has("setting"));
    assert.ok(kinds.has("command"));
    assert.ok(kinds.has("mcp"));
    assert.ok(kinds.has("skill"));
    assert.ok(!kinds.has("session"));
    assert.ok(!catalog.some((row) => row.id.startsWith("session:")));
    const mcp = catalog.find((row) => row.id === "mcp:browser-use");
    assert.equal(mcp?.kind, "mcp");
    assert.equal(mcp?.description, GITHUB_OVERFLOW_PRETEXT);
    const skill = catalog.find((row) => row.id === "skill:review");
    assert.equal(skill?.invokeAsSlash, true);
  });

  it("does not let a session mapper leak into the live catalog", () => {
    const sessions = sessionsToPaletteItems([{ id: "s1", title: "Hello" }]);
    assert.equal(sessions[0]?.kind, "session");
    const live = buildPaletteCatalog({
      commands: [],
      mcpServers: [],
      skills: [],
    });
    assert.ok(!live.some((row) => row.kind === "session"));
    assert.ok(!filterPaletteItems(live, "hello").some((row) => row.kind === "session"));
  });

  it("exposes open_agents and no longer open_tasks", () => {
    const actions = defaultPaletteActions();
    assert.ok(actions.some((a) => a.runValue === "open_agents"));
    assert.ok(!actions.some((a) => a.runValue === "open_tasks"));
  });

  it("prefills /model and /effort instead of sending them as prompts", () => {
    const actions = defaultPaletteActions();
    assert.ok(actions.some((a) => a.runValue === "prefill_model"));
    assert.ok(actions.some((a) => a.runValue === "prefill_effort"));
  });

  it("tags MCP / Skills openers with their own kinds", () => {
    const actions = defaultPaletteActions();
    const mcp = actions.find((a) => a.runValue === "open_env_mcp");
    const skills = actions.find((a) => a.runValue === "open_env_skills");
    assert.equal(mcp?.kind, "mcp");
    assert.equal(skills?.kind, "skill");
    assert.ok(actions.some((a) => a.runValue === "open_environment"));
    assert.ok(actions.some((a) => a.runValue === "open_env_plugins"));
    assert.ok(!actions.some((a) => a.runValue === "open_extensions"));
  });

  it("collapses /imagine … with a skill of the same name; keeps mcp + skill twins", () => {
    const merged = mergePaletteItems([
      defaultPaletteActions(),
      mcpToPaletteItems([{ name: "browser-use", target: "https://mcp" }]),
      skillsToPaletteItems([
        { name: "imagine", description: "Image gen", userInvocable: true },
        { name: "browser-use", description: "Browser", userInvocable: true },
      ]),
    ]);
    const imagine = merged.filter((row) => paletteItemName(row) === "imagine");
    assert.equal(imagine.length, 1);
    assert.equal(imagine[0]?.kind, "action");
    assert.ok(merged.some((row) => row.id === "mcp:browser-use"));
    assert.ok(merged.some((row) => row.id === "skill:browser-use"));
  });
});
