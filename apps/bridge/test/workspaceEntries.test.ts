/**
 * `@` completion index tests.
 * Drives the shipped listWorkspaceEntries against a real temp tree — the walk
 * is filesystem behavior, so a fake directory reader would test nothing.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { listWorkspaceEntries } from "../src/workspaceEntries.js";

const execFileAsync = promisify(execFile);

describe("listWorkspaceEntries", () => {
  let root = "";

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "grok-ws-entries-"));
    // `docs` is gitignored in this repo but authored by hand — it must stay
    // mentionable. `node_modules` is machine-written and must not.
    await writeFile(path.join(root, ".gitignore"), "docs/\ndist/\n", "utf8");
    await mkdir(path.join(root, "docs/design"), { recursive: true });
    await writeFile(path.join(root, "docs/design/brief.md"), "x", "utf8");
    await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
    await writeFile(path.join(root, "node_modules/pkg/doc.js"), "x", "utf8");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist/doc.js"), "x", "utf8");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/app.ts"), "x", "utf8");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists gitignored but human-authored content such as docs/", async () => {
    const entries = await listWorkspaceEntries(root, "doc");
    const paths = entries.map((entry) => entry.path);

    assert.ok(paths.includes("docs"), "docs directory must be mentionable");
    assert.ok(paths.includes("docs/design/brief.md"));
    assert.equal(
      entries.find((entry) => entry.path === "docs")?.kind,
      "directory",
    );
  });

  it("still skips generated and vendored trees", async () => {
    const paths = (await listWorkspaceEntries(root, "doc")).map((e) => e.path);

    assert.equal(
      paths.some((p) => p.startsWith("node_modules")),
      false,
    );
    assert.equal(
      paths.some((p) => p.startsWith("dist")),
      false,
    );
  });

  it("spends the result budget on matches, not on files scanned first", async () => {
    // `apps` sorts before `docs`, so a walk that filled maxEntries with every
    // scanned file would never reach the query's real hits.
    await mkdir(path.join(root, "apps"), { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      await writeFile(path.join(root, `apps/noise-${index}.ts`), "x", "utf8");
    }

    const paths = (
      await listWorkspaceEntries(root, "docs/", { maxEntries: 5 })
    ).map((entry) => entry.path);

    assert.ok(paths.length > 0);
    assert.ok(paths.every((p) => p.startsWith("docs/")));
  });

  it("returns nothing for a workspace that cannot be read", async () => {
    const entries = await listWorkspaceEntries(
      path.join(root, "does-not-exist"),
      "",
    );
    assert.deepEqual(entries, []);
  });

  it("non-git directory leaves ignored undefined and still lists entries", async () => {
    // root has .gitignore text but no .git — check-ignore must not filter.
    const entries = await listWorkspaceEntries(root, "src");
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.equal(
        entry.ignored,
        undefined,
        `non-git path ${entry.path} must not claim known ignore status`,
      );
    }
  });

  it("marks gitignored paths ignored:true and tracked paths false in a real repo", async () => {
    const gitRoot = await mkdtemp(path.join(os.tmpdir(), "grok-ws-git-"));
    try {
      await execFileAsync("git", ["init"], { cwd: gitRoot });
      await writeFile(path.join(gitRoot, ".gitignore"), "docs/\n", "utf8");
      await mkdir(path.join(gitRoot, "docs/design"), { recursive: true });
      await writeFile(path.join(gitRoot, "docs/design/brief.md"), "x", "utf8");
      await mkdir(path.join(gitRoot, "src"), { recursive: true });
      await writeFile(path.join(gitRoot, "src/app.ts"), "x", "utf8");

      const entries = await listWorkspaceEntries(gitRoot, "");
      const docs = entries.find((e) => e.path === "docs");
      const brief = entries.find((e) => e.path === "docs/design/brief.md");
      const src = entries.find((e) => e.path === "src");
      const app = entries.find((e) => e.path === "src/app.ts");

      assert.ok(docs, "docs must still be listed");
      assert.ok(brief, "docs/design/brief.md must still be listed");
      assert.equal(docs?.ignored, true);
      assert.equal(brief?.ignored, true);
      assert.equal(src?.ignored, false);
      assert.equal(app?.ignored, false);
    } finally {
      await rm(gitRoot, { recursive: true, force: true });
    }
  });

  it("matches absolute and file:// queries under the workspace root", async () => {
    const absFile = path.join(root, "src/app.ts");
    const absDir = path.join(root, "src");
    const byAbs = await listWorkspaceEntries(root, absFile);
    const byUri = await listWorkspaceEntries(root, `file://${absFile}`);
    const byAbsDir = await listWorkspaceEntries(root, absDir);
    const byOutside = await listWorkspaceEntries(
      root,
      path.join(os.tmpdir(), "not-this-workspace", "src/app.ts"),
    );

    assert.ok(
      byAbs.some((e) => e.path === "src/app.ts"),
      "absolute path under workspace must hit the relative entry",
    );
    assert.ok(
      byUri.some((e) => e.path === "src/app.ts"),
      "file:// absolute path under workspace must hit",
    );
    assert.ok(
      byAbsDir.some((e) => e.path === "src" || e.path.startsWith("src/")),
      "absolute directory under workspace must hit",
    );
    assert.equal(
      byOutside.some((e) => e.path === "src/app.ts"),
      false,
      "absolute path outside workspace must not false-match by suffix",
    );
  });

  it("still marks a path that matches .gitignore but was committed earlier", async () => {
    // The real repo's shape: `docs/` is ignored, yet files under it were
    // committed before the rule existed. Plain `git check-ignore` consults the
    // index and calls those "not ignored", which would strip the badge from
    // the exact directory the badge exists for.
    const gitRoot = await mkdtemp(path.join(os.tmpdir(), "grok-ws-tracked-"));
    try {
      await execFileAsync("git", ["init"], { cwd: gitRoot });
      await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: gitRoot });
      await execFileAsync("git", ["config", "user.name", "t"], { cwd: gitRoot });
      await mkdir(path.join(gitRoot, "docs"), { recursive: true });
      await writeFile(path.join(gitRoot, "docs/legacy.md"), "x", "utf8");
      // Commit first, gitignore the directory afterwards.
      await execFileAsync("git", ["add", "docs/legacy.md"], { cwd: gitRoot });
      await execFileAsync("git", ["commit", "-m", "seed", "--no-gpg-sign"], { cwd: gitRoot });
      await writeFile(path.join(gitRoot, ".gitignore"), "docs/\n", "utf8");

      const entries = await listWorkspaceEntries(gitRoot, "");
      const docs = entries.find((e) => e.path === "docs");
      const legacy = entries.find((e) => e.path === "docs/legacy.md");

      assert.equal(docs?.ignored, true, "tracked-but-ignored dir keeps the badge");
      assert.equal(legacy?.ignored, true, "tracked-but-ignored file keeps the badge");
    } finally {
      await rm(gitRoot, { recursive: true, force: true });
    }
  });
});
