/**
 * Drives shipped mention→path extract and block assemble (no mock of policy).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleMentionBlocks,
  extractCommittedMentionPaths,
  formatMentionAttachmentHint,
  MAX_EMBED_TOTAL_BYTES,
  prepareMentionSend,
  type MentionFileReadResult,
} from "@/lib/mentionAttachments";
import { MENTION_AT_MARK, MENTION_SLASH_MARK } from "@/lib/mentionTokens";

describe("extractCommittedMentionPaths", () => {
  it("only takes committed file mentions; typed @doc produces nothing", () => {
    assert.deepEqual(extractCommittedMentionPaths("look at @doc please"), []);
    assert.deepEqual(
      extractCommittedMentionPaths(`see ${MENTION_AT_MARK}docs/a.md now`),
      ["docs/a.md"],
    );
  });

  it("excludes /command mentions even when committed", () => {
    const draft = `${MENTION_SLASH_MARK}review and ${MENTION_AT_MARK}src/a.ts`;
    assert.deepEqual(extractCommittedMentionPaths(draft), ["src/a.ts"]);
  });

  it("strips quotes from spaced paths and dedupes", () => {
    const draft = `${MENTION_AT_MARK}"design docs/brief.md" and ${MENTION_AT_MARK}"design docs/brief.md" again ${MENTION_AT_MARK}src/a.ts`;
    assert.deepEqual(extractCommittedMentionPaths(draft), [
      "design docs/brief.md",
      "src/a.ts",
    ]);
  });
});

describe("assembleMentionBlocks", () => {
  const toFileUri = (p: string) => `file:///ws/${p}`;

  it("puts text first and resource blocks after", async () => {
    const reads: Record<string, MentionFileReadResult> = {
      "docs/a.md": {
        ok: true,
        content: "body-a",
        mimeType: "text/markdown",
        bytes: 6,
      },
    };
    const result = await assembleMentionBlocks({
      text: "look at @docs/a.md",
      paths: ["docs/a.md"],
      readFile: async (p) => reads[p] ?? { ok: false, bytes: 0, reason: "not_found" },
      toFileUri,
    });
    assert.equal(result.blocks[0]?.type, "text");
    assert.equal(result.blocks[1]?.type, "resource");
    if (result.blocks[1]?.type === "resource") {
      assert.equal(result.blocks[1].resource.text, "body-a");
      assert.equal(result.blocks[1].resource.uri, "file:///ws/docs/a.md");
    }
    assert.equal(result.notices.length, 0);
  });

  it("degrades oversize / binary to resource_link", async () => {
    const result = await assembleMentionBlocks({
      text: "x",
      paths: ["big.bin"],
      readFile: async () => ({
        ok: false,
        bytes: 999_999,
        reason: "too_large",
      }),
      toFileUri,
    });
    assert.equal(result.blocks[1]?.type, "resource_link");
    assert.equal(result.notices[0]?.kind, "degraded_link");
  });

  it("omits sensitive paths entirely from blocks", async () => {
    const result = await assembleMentionBlocks({
      text: "secret?",
      paths: [".env"],
      readFile: async () => ({
        ok: false,
        bytes: 0,
        reason: "sensitive",
      }),
      toFileUri,
    });
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0]?.type, "text");
    assert.equal(result.notices[0]?.kind, "skipped_sensitive");
    assert.match(formatMentionAttachmentHint(result.notices), /Skipped sensitive/);
  });

  it("truncates by total embed budget in mention order", async () => {
    // First file nearly fills the budget; second must degrade to resource_link.
    const fat = "y".repeat(MAX_EMBED_TOTAL_BYTES - 4);
    const result = await assembleMentionBlocks({
      text: "two",
      paths: ["a.md", "b.md"],
      readFile: async (p) => {
        if (p === "a.md") {
          return {
            ok: true,
            content: fat,
            bytes: fat.length,
            mimeType: "text/plain",
          };
        }
        return {
          ok: true,
          content: "second",
          bytes: 6,
          mimeType: "text/plain",
        };
      },
      toFileUri,
    });
    const types = result.blocks.map((b) => b.type);
    assert.deepEqual(types, ["text", "resource", "resource_link"]);
    assert.equal(result.notices[0]?.kind, "truncated_budget");
  });

  it("directory mentions become resource_link only", async () => {
    const result = await assembleMentionBlocks({
      text: "dir",
      paths: ["docs"],
      readFile: async () => {
        throw new Error("should not read directory body");
      },
      toFileUri,
    });
    assert.equal(result.blocks[1]?.type, "resource_link");
    assert.equal(result.notices[0]?.kind, "directory_link");
  });
});

describe("prepareMentionSend", () => {
  it("materializes marks and extracts committed paths", () => {
    const draft = `check ${MENTION_AT_MARK}docs/x.md please`;
    const prepared = prepareMentionSend(draft);
    assert.equal(prepared.text, "check @docs/x.md please");
    assert.deepEqual(prepared.paths, ["docs/x.md"]);
  });
});
