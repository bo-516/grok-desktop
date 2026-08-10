/**
 * Reverse-service tests: unknown method → MethodNotImplementedError (-32601),
 * fs happy path under cwd, terminal create/kill (TC-REV-04/06, F-REV-08/09).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  handleReverseRequest,
  MethodNotImplementedError,
  TerminalRegistry,
} from "../src/reverseServices.js";

describe("reverseServices", () => {
  it("throws MethodNotImplementedError with method name for unknown reverse methods", async () => {
    const terminals = new TerminalRegistry();
    await assert.rejects(
      () =>
        handleReverseRequest(
          "terminal/does_not_exist_xyz",
          {},
          process.cwd(),
          terminals,
        ),
      (e: unknown) => {
        assert.ok(e instanceof MethodNotImplementedError);
        assert.equal(e.code, -32601);
        assert.match(e.message, /terminal\/does_not_exist_xyz/);
        return true;
      },
    );
    terminals.disposeAll();
  });

  it("reads and writes only inside workspace", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rev-fs-"));
    const terminals = new TerminalRegistry();
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "a.ts"), "hello", "utf8");

    const read = (await handleReverseRequest(
      "fs/read_text_file",
      { path: "src/a.ts" },
      dir,
      terminals,
    )) as { content: string };
    assert.equal(read.content, "hello");

    await handleReverseRequest(
      "fs/write_text_file",
      { path: "src/b.ts", content: "world" },
      dir,
      terminals,
    );
    assert.equal(
      await readFile(path.join(dir, "src", "b.ts"), "utf8"),
      "world",
    );

    await assert.rejects(
      () =>
        handleReverseRequest(
          "fs/read_text_file",
          { path: "../outside.txt" },
          dir,
          terminals,
        ),
      /outside workspace/,
    );
    await assert.rejects(
      () =>
        handleReverseRequest(
          "fs/write_text_file",
          { path: path.join(`${dir}-evil`, "x"), content: "no" },
          dir,
          terminals,
        ),
      /outside workspace/,
    );
    terminals.disposeAll();
  });

  it("creates and kills a terminal process", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rev-term-"));
    const terminals = new TerminalRegistry();
    const created = (await handleReverseRequest(
      "terminal/create",
      {
        command: process.execPath,
        args: ["-e", "console.log('term-ok'); process.exit(0)"],
      },
      dir,
      terminals,
    )) as { terminalId: string };
    assert.ok(created.terminalId);

    const waited = (await handleReverseRequest(
      "terminal/wait_for_exit",
      { terminalId: created.terminalId, timeoutMs: 10_000 },
      dir,
      terminals,
    )) as { output: string; exitCode: number | null };
    assert.match(waited.output, /term-ok/);
    assert.equal(waited.exitCode, 0);

    const killed = (await handleReverseRequest(
      "terminal/kill",
      { terminalId: created.terminalId },
      dir,
      terminals,
    )) as { ok: boolean };
    // Already exited — kill may report ok false if released after wait cleanup
    assert.equal(typeof killed.ok, "boolean");
    terminals.disposeAll();
  });

  it("runs a full shell-line command without crashing the process", async () => {
    // Agent often sends `/bin/bash -lc '…'` as a single command string with no
    // args. shell:false would ENOENT and used to kill the bridge via unhandled
    // ChildProcess 'error'.
    const dir = await mkdtemp(path.join(os.tmpdir(), "rev-shell-"));
    const terminals = new TerminalRegistry();
    const created = (await handleReverseRequest(
      "terminal/create",
      {
        command: `${process.execPath} -e "console.log('shell-line-ok')"`,
      },
      dir,
      terminals,
    )) as { terminalId: string };
    assert.ok(created.terminalId);

    const waited = (await handleReverseRequest(
      "terminal/wait_for_exit",
      { terminalId: created.terminalId, timeoutMs: 10_000 },
      dir,
      terminals,
    )) as { output: string; exitCode: number | null };
    assert.match(waited.output, /shell-line-ok/);
    assert.equal(waited.exitCode, 0);
    terminals.disposeAll();
  });

  it("records spawn ENOENT on the handle instead of throwing unhandled error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rev-enoent-"));
    const terminals = new TerminalRegistry();
    // Explicit argv pointing at a path that cannot exist — shell:false ENOENT.
    const created = (await handleReverseRequest(
      "terminal/create",
      {
        command: "/this/path/does/not/exist/grok-desktop-term-bin",
        args: ["--noop"],
      },
      dir,
      terminals,
    )) as { terminalId: string };

    const waited = (await handleReverseRequest(
      "terminal/wait_for_exit",
      { terminalId: created.terminalId, timeoutMs: 5_000 },
      dir,
      terminals,
    )) as { output: string; exitCode: number | null };
    assert.equal(waited.exitCode, 1);
    assert.match(waited.output, /spawn failed/i);
    // If the unhandled 'error' path still fired, this process would already be dead.
    terminals.disposeAll();
  });
});
