/**
 * Grammar resolution for syntax highlighting: which paths and Markdown fences
 * map onto a grammar, and which correctly resolve to null (plain text).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  languageForFenceClass,
  languageForPath,
} from "@/lib/codeHighlightLanguages";

describe("languageForPath", () => {
  it("maps the repo's own extensions onto grammars", () => {
    assert.equal(languageForPath("apps/desktop/src/App.tsx"), "tsx");
    assert.equal(languageForPath("src/lib/diffCore.ts"), "typescript");
    assert.equal(languageForPath("internal/acp/client.go"), "go");
    assert.equal(languageForPath("styles/defineColor.css"), "css");
    assert.equal(languageForPath("package.json"), "json");
    assert.equal(languageForPath("scripts/run-dev.sh"), "shellscript");
  });

  it("ignores directories and is case-insensitive on the extension", () => {
    assert.equal(languageForPath("/Users/x/My.Go.Project/main.GO"), "go");
    assert.equal(languageForPath("C:\\work\\app\\Main.TS"), "typescript");
  });

  it("returns null rather than guessing when there is no usable extension", () => {
    assert.equal(languageForPath(".gitignore"), null);
    assert.equal(languageForPath("Makefile"), null);
    assert.equal(languageForPath("archive.tar."), null);
    assert.equal(languageForPath("pnpm-lock.yaml.bak"), null);
    assert.equal(languageForPath(undefined), null);
    assert.equal(languageForPath(""), null);
  });
});

describe("languageForFenceClass", () => {
  it("reads the grammar out of a fence class", () => {
    assert.equal(languageForFenceClass("language-tsx"), "tsx");
    assert.equal(languageForFenceClass("md-code language-go"), "go");
  });

  it("accepts the short aliases agents actually emit", () => {
    assert.equal(languageForFenceClass("language-ts"), "typescript");
    assert.equal(languageForFenceClass("language-sh"), "shellscript");
    assert.equal(languageForFenceClass("language-bash"), "shellscript");
    assert.equal(languageForFenceClass("language-YAML"), "yaml");
  });

  it("returns null for inline code and unsupported fences", () => {
    assert.equal(languageForFenceClass(undefined), null);
    assert.equal(languageForFenceClass("md-inline-code"), null);
    assert.equal(languageForFenceClass("language-brainfuck"), null);
    // A class that merely contains the word must not match.
    assert.equal(languageForFenceClass("no-language-go"), null);
  });
});
