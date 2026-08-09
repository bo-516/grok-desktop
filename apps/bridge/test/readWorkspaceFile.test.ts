/**
 * Drives the shipped readWorkspaceFileForEmbed guards (path sandbox, sensitive,
 * size, binary, directory). Uses a real temp tree so resolution and IO are real.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  isSensitiveWorkspacePath,
  MAX_EMBED_FILE_BYTES,
  readWorkspaceFileForEmbed,
} from "../src/readWorkspaceFile.js";

describe("readWorkspaceFileForEmbed", () => {
  let root = "";

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "read-ws-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/ok.md"), "# hello\n", "utf8");
    await writeFile(path.join(root, ".env"), "SECRET=1\n", "utf8");
    await writeFile(path.join(root, ".env.local"), "SECRET=2\n", "utf8");
    await writeFile(path.join(root, "id_rsa"), "-----BEGIN\n", "utf8");
    await writeFile(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 255]));
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/note.md"), "note body\n", "utf8");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns content and bytes for an in-bounds text file", async () => {
    const result = await readWorkspaceFileForEmbed(root, "src/ok.md");
    assert.equal(result.ok, true);
    assert.equal(result.content, "# hello\n");
    assert.equal(result.bytes, Buffer.byteLength("# hello\n", "utf8"));
    assert.equal(result.mimeType, "text/markdown");
    assert.equal(result.reason, undefined);
  });

  it("rejects path escape without returning content", async () => {
    const result = await readWorkspaceFileForEmbed(root, "../evil.md");
    assert.equal(result.ok, false);
    assert.equal(result.content, undefined);
    assert.equal(result.reason, "outside");
  });

  it("rejects sensitive names (.env, keys) without content", async () => {
    assert.equal(isSensitiveWorkspacePath(".env"), true);
    assert.equal(isSensitiveWorkspacePath(".env.local"), true);
    assert.equal(isSensitiveWorkspacePath("id_rsa"), true);
    assert.equal(isSensitiveWorkspacePath("src/ok.md"), false);

    const env = await readWorkspaceFileForEmbed(root, ".env");
    assert.equal(env.ok, false);
    assert.equal(env.reason, "sensitive");
    assert.equal(env.content, undefined);

    const key = await readWorkspaceFileForEmbed(root, "id_rsa");
    assert.equal(key.ok, false);
    assert.equal(key.reason, "sensitive");
  });

  it("rejects oversize files with too_large and bytes", async () => {
    const bigPath = "src/big.md";
    const big = "x".repeat(MAX_EMBED_FILE_BYTES + 1);
    await writeFile(path.join(root, bigPath), big, "utf8");
    const result = await readWorkspaceFileForEmbed(root, bigPath);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "too_large");
    assert.equal(result.content, undefined);
    assert.ok(result.bytes > MAX_EMBED_FILE_BYTES);
  });

  it("rejects binary buffers", async () => {
    const result = await readWorkspaceFileForEmbed(root, "bin.dat");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "binary");
    assert.equal(result.content, undefined);
  });

  it("rejects directories for embedding", async () => {
    const result = await readWorkspaceFileForEmbed(root, "docs");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "directory");
    assert.equal(result.content, undefined);
  });

  it("returns not_found for missing paths inside workspace", async () => {
    const result = await readWorkspaceFileForEmbed(root, "src/missing.md");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
  });
});
