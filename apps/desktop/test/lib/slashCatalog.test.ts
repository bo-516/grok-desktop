/**
 * Last-known slash catalog: persist, inspect fill, New chat seed.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  SLASH_CATALOG_STORAGE_KEY,
  commandsFromInspectSkills,
  loadSlashCatalog,
  rememberSlashCatalog,
  resolveSlashCatalog,
  withCachedSlashCatalog,
} from "@/lib/slashCatalog";

/** In-memory localStorage stub for persist tests. */
function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

/** Install a Storage stub on globalThis.localStorage. */
function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: undefined,
  });
});

describe("slashCatalog persist", () => {
  it("round-trips a live catalog and ignores empty writes", () => {
    installLocalStorage(createMemoryStorage());
    assert.deepEqual(loadSlashCatalog(), []);
    assert.equal(rememberSlashCatalog([]), false);
    assert.equal(
      rememberSlashCatalog([
        { name: "compact", description: "Compress" },
        { name: "workflow", description: "Run workflow" },
      ]),
      true,
    );
    const loaded = loadSlashCatalog();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0]?.name, "compact");
    assert.equal(rememberSlashCatalog(loaded), false);
  });

  it("unions a shorter incoming list so initialize builtins are not dropped", () => {
    installLocalStorage(createMemoryStorage());
    rememberSlashCatalog([
      { name: "compact", description: "Compress" },
      { name: "context", description: "Usage" },
      { name: "design", description: "Design" },
    ]);
    assert.equal(
      rememberSlashCatalog([
        { name: "compact", description: "Compress" },
        { name: "context", description: "Usage" },
      ]),
      false,
    );
    assert.equal(loadSlashCatalog().length, 3);
    assert.equal(
      rememberSlashCatalog([{ name: "workflow", description: "Run workflow" }]),
      true,
    );
    assert.equal(loadSlashCatalog().length, 4);
  });

  it("replaces the cache when the live list grows", () => {
    installLocalStorage(createMemoryStorage());
    rememberSlashCatalog([{ name: "compact", description: "Compress" }]);
    assert.equal(
      rememberSlashCatalog([
        { name: "compact", description: "Compress" },
        { name: "design", description: "Design" },
      ]),
      true,
    );
    assert.equal(loadSlashCatalog()[1]?.name, "design");
  });

  it("returns [] when storage is missing or corrupt", () => {
    assert.deepEqual(loadSlashCatalog(), []);
    installLocalStorage(
      createMemoryStorage({ [SLASH_CATALOG_STORAGE_KEY]: "{not-json" }),
    );
    assert.deepEqual(loadSlashCatalog(), []);
  });
});

describe("resolveSlashCatalog", () => {
  it("leads with desktop /model /effort, then live, then inspect skills", () => {
    const resolved = resolveSlashCatalog(
      [{ name: "compact", description: "Compress" }],
      [{ name: "stale", description: "old", _meta: { scope: "user" } }],
      [
        {
          name: "design",
          description: "Write a design",
          userInvocable: true,
          source: { kind: "bundled", path: "/skills/design/SKILL.md" },
        },
        { name: "hidden", description: "internal", userInvocable: false },
        { name: "compact", description: "skill dup", userInvocable: true },
      ],
    );
    const names = resolved.map((row) => row.name);
    assert.deepEqual(names, ["model", "effort", "compact", "design"]);
    assert.equal(resolved.find((row) => row.name === "compact")?.description, "Compress");
    assert.equal(resolved.find((row) => row.name === "design")?._meta?.scope, "bundled");
  });

  it("recovers cached non-skill builtins when live is skills-only", () => {
    const resolved = resolveSlashCatalog(
      [
        {
          name: "pr-babysit",
          description: "Watch PRs",
          _meta: { scope: "bundled" },
        },
      ],
      [
        { name: "compact", description: "Compress" },
        { name: "context", description: "Usage" },
      ],
      [],
    );
    const names = resolved.map((row) => row.name);
    assert.ok(names.includes("model"));
    assert.ok(names.includes("effort"));
    assert.ok(names.includes("compact"));
    assert.ok(names.includes("context"));
    assert.ok(names.includes("pr-babysit"));
  });

  it("uses the cached catalog when live is empty, after desktop builtins", () => {
    const resolved = resolveSlashCatalog(
      [],
      [{ name: "workflow", description: "Run workflow" }],
      [],
    );
    assert.equal(resolved[0]?.name, "model");
    assert.equal(resolved[1]?.name, "effort");
    assert.equal(resolved[2]?.name, "workflow");
  });
});

describe("commandsFromInspectSkills", () => {
  it("keeps only user-invocable skills", () => {
    const commands = commandsFromInspectSkills([
      { name: "imagine", userInvocable: true, source: { kind: "bundled" } },
      { name: "internal", userInvocable: false },
    ]);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.name, "imagine");
  });
});

describe("withCachedSlashCatalog", () => {
  it("does not replace a canvas that already has commands", () => {
    installLocalStorage(createMemoryStorage());
    rememberSlashCatalog([{ name: "cached", description: "from disk" }]);
    const session = createSessionState({ id: "s1", workspace: "/w" });
    session.availableCommands = [{ name: "live", description: "handshake" }];
    const next = withCachedSlashCatalog(session);
    assert.equal(next.availableCommands?.[0]?.name, "live");
  });

  it("seeds an empty canvas from the persisted catalog", () => {
    installLocalStorage(createMemoryStorage());
    rememberSlashCatalog([{ name: "compact", description: "Compress" }]);
    const session = createSessionState({ id: "", workspace: "" });
    const next = withCachedSlashCatalog(session);
    assert.equal(next.availableCommands?.[0]?.name, "compact");
  });
});
