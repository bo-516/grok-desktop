import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  defaultMcpLogDir,
  listMcpStderrLogs,
  readMcpStderrLog,
} from "../src/mcpLogReader.js";

describe("mcpLogReader", () => {
  it("reads server stderr log under home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "mcp-log-"));
    const dir = defaultMcpLogDir(home);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "fs.stderr.log"), "boom\n", "utf8");
    assert.equal(await readMcpStderrLog("fs", home), "boom\n");
    assert.deepEqual(await listMcpStderrLogs(home), ["fs.stderr.log"]);
    // Path traversal / unsafe names must not read outside the log dir.
    assert.equal(await readMcpStderrLog("../etc/passwd", home), "");
    assert.equal(await readMcpStderrLog("/etc/passwd", home), "");
    assert.equal(await readMcpStderrLog("a/b", home), "");
  });
});
