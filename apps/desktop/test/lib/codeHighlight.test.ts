/**
 * Syntax highlighting: size guards, token→class mapping, line flattening, and
 * one end-to-end tokenize proving Shiki is wired to the css-variables theme
 * (semantic kinds, never hex) so defineColor stays the only colour authority.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canHighlight,
  flattenCodeLines,
  highlightToLines,
  MAX_HIGHLIGHT_CHARS,
  tokenClassName,
  type CodeLine,
  type CodeToken,
} from "@/lib/codeHighlight";

/**
 * Build a token without repeating the optional flags at every call site.
 * @param over Fields to override on a plain zero-offset token.
 */
function token(over: Partial<CodeToken>): CodeToken {
  return { content: "x", kind: "plain", offset: 0, ...over };
}

describe("canHighlight", () => {
  it("requires a grammar and non-empty content", () => {
    assert.equal(canHighlight("const a = 1", "typescript"), true);
    assert.equal(canHighlight("const a = 1", null), false);
    assert.equal(canHighlight("", "typescript"), false);
  });

  it("bails past the size guard so the drawer cannot stall on a bundle", () => {
    const huge = "a".repeat(MAX_HIGHLIGHT_CHARS + 1);
    assert.equal(canHighlight(huge, "typescript"), false);
    assert.equal(canHighlight("a".repeat(MAX_HIGHLIGHT_CHARS), "typescript"), true);
  });
});

describe("tokenClassName", () => {
  it("adds no colour class for plain runs so they inherit body text", () => {
    assert.equal(tokenClassName(token({})), "code-tok");
  });

  it("names the semantic kind, not a colour", () => {
    assert.equal(
      tokenClassName(token({ kind: "keyword" })),
      "code-tok code-tok-keyword",
    );
    assert.equal(
      tokenClassName(token({ kind: "string-expression" })),
      "code-tok code-tok-string-expression",
    );
  });

  it("appends font-style flags after the kind", () => {
    assert.equal(
      tokenClassName(token({ kind: "comment", italic: true })),
      "code-tok code-tok-comment code-tok-italic",
    );
    assert.equal(
      tokenClassName(token({ bold: true, underline: true })),
      "code-tok code-tok-bold code-tok-underline",
    );
  });
});

describe("flattenCodeLines", () => {
  it("rejoins lines with newline runs at the right offsets", () => {
    const lines: CodeLine[] = [
      [token({ content: "ab", offset: 0 })],
      [token({ content: "cd", offset: 3, kind: "keyword" })],
    ];
    const flat = flattenCodeLines(lines);
    assert.deepEqual(
      flat.map((t) => t.content),
      ["ab", "\n", "cd"],
    );
    assert.deepEqual(
      flat.map((t) => t.offset),
      [0, 2, 3],
    );
  });

  it("keeps offsets unique across empty lines", () => {
    const lines: CodeLine[] = [
      [token({ content: "a", offset: 0 })],
      [],
      [token({ content: "b", offset: 3 })],
    ];
    const offsets = flattenCodeLines(lines).map((t) => t.offset);
    assert.equal(new Set(offsets).size, offsets.length);
  });

  it("round-trips to the original source text", () => {
    const lines: CodeLine[] = [
      [token({ content: "const", offset: 0, kind: "keyword" })],
      [],
      [token({ content: "done", offset: 7 })],
    ];
    const text = flattenCodeLines(lines)
      .map((t) => t.content)
      .join("");
    assert.equal(text, "const\n\ndone");
  });
});

describe("highlightToLines", () => {
  it("tokenizes TSX into semantic kinds and never leaks a colour literal", async () => {
    const code = "// note\nconst greeting = 'hi';\n";
    const lines = await highlightToLines(code, "tsx");
    assert.ok(lines, "expected tokens for a supported grammar");
    // Line indexes are the gutter's 1-based numbers minus one.
    assert.equal(lines[0].map((t) => t.content).join(""), "// note");
    assert.equal(lines[1].map((t) => t.content).join(""), "const greeting = 'hi';");
    const kinds = new Set(lines.flat().map((t) => t.kind));
    assert.ok(kinds.has("comment"), "comment kind missing");
    assert.ok(kinds.has("keyword"), "keyword kind missing");
    const serialized = JSON.stringify(lines);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(serialized), "hex colour leaked into tokens");
    assert.ok(!serialized.includes("var(--shiki"), "raw shiki variable leaked into tokens");
  });

  it("keeps the kind splits VS Code's default themes draw", async () => {
    // Control flow, declaration keywords, types, calls and plain identifiers
    // all collapse onto two or three variables in Shiki's stock theme; the
    // extra rules in codeHighlight are what keep them apart, and a grammar or
    // Shiki upgrade that reordered them would regress silently.
    const code =
      "import { useState } from 'react';\n" +
      "export function run(param: Props) { const total = 1; return param; }\n";
    const lines = await highlightToLines(code, "tsx");
    assert.ok(lines);
    const kindOf = (word: string) =>
      lines.flat().find((t) => t.content.trim() === word)?.kind;
    assert.equal(kindOf("import"), "control");
    assert.equal(kindOf("return"), "control");
    assert.equal(kindOf("function"), "keyword");
    assert.equal(kindOf("Props"), "type");
    assert.equal(kindOf("run"), "function");
    assert.equal(kindOf("param"), "variable");
    assert.equal(kindOf("useState"), "variable");
    assert.equal(kindOf("total"), "constant");
    assert.equal(kindOf("1"), "number");
    // Operators are editor foreground in VS Code, not keyword-coloured.
    assert.equal(kindOf("="), "plain");
  });

  it("highlights Go through the same path", async () => {
    const lines = await highlightToLines('package main\n// c\n', "go");
    assert.ok(lines);
    assert.ok(lines.flat().some((t) => t.kind === "keyword"));
    assert.ok(lines.flat().some((t) => t.kind === "comment"));
  });

  it("returns null instead of throwing when highlighting is not possible", async () => {
    assert.equal(await highlightToLines("anything", null), null);
    assert.equal(await highlightToLines("", "tsx"), null);
    assert.equal(
      await highlightToLines("a".repeat(MAX_HIGHLIGHT_CHARS + 1), "tsx"),
      null,
    );
  });

  it("keeps offsets aligned with the source so token keys stay unique", async () => {
    const code = "const a = 1;\nconst b = 2;\n";
    const lines = await highlightToLines(code, "typescript");
    assert.ok(lines);
    for (const line of lines) {
      for (const t of line) {
        assert.equal(code.slice(t.offset, t.offset + t.content.length), t.content);
      }
    }
  });
});
