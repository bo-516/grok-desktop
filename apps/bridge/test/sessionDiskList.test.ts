/**
 * On-disk ~/.grok/sessions enumeration for multi-workspace rail catalog.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  decodeWorkspaceDirName,
  listSessionsFromDisk,
  readDiskSessionRow,
} from "../src/sessionDiskList.js";

describe("sessionDiskList", () => {
  it("decodeWorkspaceDirName unescapes percent-encoded paths", () => {
    assert.equal(
      decodeWorkspaceDirName("%2FUsers%2Fme%2Fdemo"),
      "/Users/me/demo",
    );
  });

  it("listSessionsFromDisk returns rows from every workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-sessions-"));
    const grokHome = root;
    const sessionsRoot = path.join(grokHome, "sessions");
    const demoEnc = encodeURIComponent("/tmp/demo");
    const otherEnc = encodeURIComponent("/tmp/other");
    const demoSid = "019fe000-0000-7000-8000-000000000001";
    const otherSid = "019fe000-0000-7000-8000-000000000002";
    await mkdir(path.join(sessionsRoot, demoEnc, demoSid), { recursive: true });
    await mkdir(path.join(sessionsRoot, otherEnc, otherSid), {
      recursive: true,
    });
    await writeFile(
      path.join(sessionsRoot, demoEnc, demoSid, "summary.json"),
      JSON.stringify({
        info: { id: demoSid, cwd: "/tmp/demo" },
        generated_title: "Demo chat",
        updated_at: "2026-08-09T10:00:00.000Z",
        created_at: "2026-08-09T09:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(sessionsRoot, otherEnc, otherSid, "summary.json"),
      JSON.stringify({
        info: { id: otherSid, cwd: "/tmp/other" },
        session_summary: "Other project",
        updated_at: "2026-08-08T10:00:00.000Z",
      }),
    );

    const rows = await listSessionsFromDisk({ grokHome, limit: 50 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, demoSid);
    assert.equal(rows[0]?.cwd, "/tmp/demo");
    assert.equal(rows[0]?.title, "Demo chat");
    assert.equal(rows[1]?.id, otherSid);
    assert.equal(rows[1]?.cwd, "/tmp/other");

    const filtered = await listSessionsFromDisk({
      grokHome,
      cwdFilter: "/tmp/other",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, otherSid);
  });

  it("readDiskSessionRow falls back to folder cwd and mtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-sess-row-"));
    const sid = "019fe000-0000-7000-8000-000000000099";
    const dir = path.join(root, sid);
    await mkdir(dir, { recursive: true });
    // No summary.json — mtime-based row still works.
    const row = await readDiskSessionRow(dir, sid, "/fallback/ws");
    assert.ok(row);
    assert.equal(row?.id, sid);
    assert.equal(row?.cwd, "/fallback/ws");
    assert.ok(row?.updatedAt);
  });
});
