/**
 * Bridge write_workspace_file boundary uses shipped resolveWorkspacePath (F-NATIVE-06 apply).
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveWorkspacePath } from "../src/workspacePath.js";

describe("write workspace apply path", () => {
  it("writes under workspace and rejects escape", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "write-ws-"));
    await mkdir(path.join(dir, "src"), { recursive: true });
    const abs = resolveWorkspacePath(dir, "src/out.ts");
    await writeFile(abs, "hello", "utf8");
    assert.equal(await readFile(abs, "utf8"), "hello");
    assert.throws(() => resolveWorkspacePath(dir, "../evil.ts"), /outside/);
  });
});
