/**
 * Managed prompt format: serialize / parse / golden (F-01..F-08).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  MANAGED_MARKER,
  parsePrompts,
  serializePrompts,
  type PromptEntry,
} from "../src/userPromptsFormat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(__dirname, "fixtures", "prompts-golden");

function entry(
  text: string,
  opts: Partial<PromptEntry> = {},
): PromptEntry {
  return {
    id: opts.id ?? "x",
    text,
    enabled: opts.enabled !== false,
    ...(opts.category ? { category: opts.category } : {}),
  };
}

describe("userPromptsFormat", () => {
  it("F-01: empty entries serialize to null", () => {
    assert.equal(serializePrompts([]), null);
  });

  it("F-02: enabled entry → `- text`", () => {
    const body = serializePrompts([entry("Always respond in zh-CN.")]);
    assert.ok(body);
    assert.match(body!, /^- Always respond in zh-CN\.$/m);
  });

  it("F-03: disabled entry → off comment", () => {
    const body = serializePrompts([
      entry("Prefer concise answers.", { enabled: false }),
    ]);
    assert.ok(body);
    assert.match(
      body!,
      /<!-- grok-desktop:off Prefer concise answers\. -->/,
    );
  });

  it("F-04: category markers round-trip (enabled + disabled)", () => {
    const entries: PromptEntry[] = [
      entry("Always respond in zh-CN.", {
        id: "a",
        category: "language",
      }),
      entry("Prefer concise answers.", {
        id: "b",
        enabled: false,
        category: "style",
      }),
    ];
    const body = serializePrompts(entries);
    assert.ok(body);
    const parsed = parsePrompts(body!);
    assert.equal(parsed.foreign, false);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0]!.text, "Always respond in zh-CN.");
    assert.equal(parsed.entries[0]!.enabled, true);
    assert.equal(parsed.entries[0]!.category, "language");
    assert.equal(parsed.entries[1]!.text, "Prefer concise answers.");
    assert.equal(parsed.entries[1]!.enabled, false);
    assert.equal(parsed.entries[1]!.category, "style");
  });

  it("F-05: round-trip preserves text/enabled/category/order", () => {
    const entries: PromptEntry[] = [
      entry("A", { id: "1", category: "name" }),
      entry("B", { id: "2", enabled: false }),
      entry("C", { id: "3", category: "workflow" }),
    ];
    const body = serializePrompts(entries);
    const parsed = parsePrompts(body!);
    assert.equal(parsed.entries.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(parsed.entries[i]!.text, entries[i]!.text);
      assert.equal(parsed.entries[i]!.enabled, entries[i]!.enabled);
      assert.equal(parsed.entries[i]!.category, entries[i]!.category);
    }
  });

  it("F-06: tolerant parse — CRLF, blanks, trailing space, unknown lines", () => {
    const body = [
      MANAGED_MARKER,
      "<!-- Edited in the grok-desktop app. Manual edits are overwritten. -->",
      "",
      "- Keep me.  ",
      "",
      "not a valid line",
      "<!-- random comment -->",
      "- Second.",
      "",
    ].join("\r\n");
    const parsed = parsePrompts(body);
    assert.equal(parsed.foreign, false);
    assert.deepEqual(
      parsed.entries.map((e) => e.text),
      ["Keep me.", "Second."],
    );
  });

  it("F-07: golden bytes match fixtures", () => {
    const basicEntries: PromptEntry[] = [
      entry("Always respond in zh-CN.", {
        id: "a",
        category: "language",
      }),
      entry("My name is Jack.", { id: "b", category: "name" }),
      entry("Prefer concise answers.", {
        id: "c",
        enabled: false,
        category: "style",
      }),
    ];
    const basic = serializePrompts(basicEntries);
    const goldenBasic = readFileSync(path.join(GOLDEN, "basic.md"), "utf8");
    assert.equal(basic, goldenBasic);

    const mixedEntries: PromptEntry[] = [
      entry("Run lint before commit.", {
        id: "a",
        category: "workflow",
      }),
      entry("Prefer small pure functions.", { id: "b" }),
      entry("Do not use emoji.", { id: "c", enabled: false }),
    ];
    const mixed = serializePrompts(mixedEntries);
    const goldenMixed = readFileSync(path.join(GOLDEN, "mixed.md"), "utf8");
    assert.equal(mixed, goldenMixed);
  });

  it("F-08: missing managed marker → foreign, empty entries", () => {
    const parsed = parsePrompts("# hand written\n- do not touch\n");
    assert.equal(parsed.foreign, true);
    assert.deepEqual(parsed.entries, []);
  });
});
