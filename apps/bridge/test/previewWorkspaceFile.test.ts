/**
 * Drives shipped readWorkspaceFileForPreview: happy path, sensitive reject,
 * oversize truncates with truncated flag (does not hard-fail like embed).
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  MAX_PREVIEW_FILE_BYTES,
  readWorkspaceFileForEmbed,
  readWorkspaceFileForPreview,
} from "../src/readWorkspaceFile.js";

describe("readWorkspaceFileForPreview", () => {
  let root = "";

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "preview-ws-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/ok.ts"), "export const n = 1;\n", "utf8");
    await writeFile(path.join(root, ".env"), "SECRET=1\n", "utf8");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns content for an in-bounds text file", async () => {
    const result = await readWorkspaceFileForPreview(root, "src/ok.ts");
    assert.equal(result.ok, true);
    assert.equal(result.content, "export const n = 1;\n");
    assert.equal(result.truncated, undefined);
    assert.ok((result.bytes ?? 0) > 0);
  });

  it("rejects sensitive paths with reason and no content", async () => {
    const result = await readWorkspaceFileForPreview(root, ".env");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "sensitive");
    assert.equal(result.content, undefined);
  });

  it("truncates oversize content with truncated flag (does not hard-fail)", async () => {
    const bigPath = "src/big.txt";
    const payload = "A".repeat(MAX_PREVIEW_FILE_BYTES + 4096);
    await writeFile(path.join(root, bigPath), payload, "utf8");
    const result = await readWorkspaceFileForPreview(root, bigPath);
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert.ok(result.content);
    assert.ok(result.content!.length <= MAX_PREVIEW_FILE_BYTES + 4);
    assert.ok((result.bytes ?? 0) > MAX_PREVIEW_FILE_BYTES);

    // Embed path still hard-fails oversize (unchanged contract).
    const embed = await readWorkspaceFileForEmbed(root, bigPath);
    assert.equal(embed.ok, false);
    assert.equal(embed.reason, "too_large");
  });
});
