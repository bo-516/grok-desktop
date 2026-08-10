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
  isSubagentSessionKind,
  listSessionsFromDisk,
  readDiskSessionRow,
} from "../src/sessionDiskList.js";
import { sessionsList } from "../src/cliCommands.js";

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
    assert.equal(rows[0]?.sessionKind, undefined);
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

  it("isSubagentSessionKind uses prefix for all three known variants", () => {
    assert.equal(isSubagentSessionKind("subagent"), true);
    assert.equal(isSubagentSessionKind("subagent_resume"), true);
    assert.equal(isSubagentSessionKind("subagent_fork"), true);
    assert.equal(isSubagentSessionKind(undefined), false);
    assert.equal(isSubagentSessionKind(""), false);
    assert.equal(isSubagentSessionKind("main"), false);
    assert.equal(isSubagentSessionKind("future_role"), false);
  });

  it("exposes sessionKind and parentSessionId from summary + subagents meta", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-sessions-kind-"));
    const grokHome = root;
    const sessionsRoot = path.join(grokHome, "sessions");
    const wsEnc = encodeURIComponent("/tmp/kind-demo");
    const parentId = "019fe100-0000-7000-8000-000000000001";
    const childId = "019fe100-0000-7000-8000-000000000002";
    const resumeId = "019fe100-0000-7000-8000-000000000003";
    const parentDir = path.join(sessionsRoot, wsEnc, parentId);
    const childDir = path.join(sessionsRoot, wsEnc, childId);
    const resumeDir = path.join(sessionsRoot, wsEnc, resumeId);
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    await mkdir(resumeDir, { recursive: true });
    await mkdir(path.join(parentDir, "subagents", childId), { recursive: true });
    await writeFile(
      path.join(parentDir, "summary.json"),
      JSON.stringify({
        info: { id: parentId, cwd: "/tmp/kind-demo" },
        generated_title: "Parent chat",
        updated_at: "2026-08-09T12:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(childDir, "summary.json"),
      JSON.stringify({
        info: { id: childId, cwd: "/tmp/kind-demo" },
        generated_title: "Goal plan writer",
        session_kind: "subagent",
        updated_at: "2026-08-09T11:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(resumeDir, "summary.json"),
      JSON.stringify({
        info: { id: resumeId, cwd: "/tmp/kind-demo" },
        generated_title: "Resumed worker",
        session_kind: "subagent_resume",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(parentDir, "subagents", childId, "meta.json"),
      JSON.stringify({
        child_session_id: childId,
        subagent_id: childId,
      }),
    );

    const rows = await listSessionsFromDisk({ grokHome, limit: 50 });
    // Data layer must keep subagent rows (filter is render-only).
    assert.equal(rows.length, 3);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get(parentId)?.sessionKind, undefined);
    assert.equal(byId.get(parentId)?.parentSessionId, undefined);
    assert.equal(byId.get(childId)?.sessionKind, "subagent");
    assert.equal(byId.get(childId)?.parentSessionId, parentId);
    assert.equal(byId.get(resumeId)?.sessionKind, "subagent_resume");
  });

  it("corrupt meta / missing subagents dir does not throw", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-sessions-meta-"));
    const grokHome = root;
    const sessionsRoot = path.join(grokHome, "sessions");
    const wsEnc = encodeURIComponent("/tmp/meta-demo");
    const parentId = "019fe200-0000-7000-8000-000000000001";
    const childId = "019fe200-0000-7000-8000-000000000002";
    const parentDir = path.join(sessionsRoot, wsEnc, parentId);
    const childDir = path.join(sessionsRoot, wsEnc, childId);
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    await mkdir(path.join(parentDir, "subagents", childId), { recursive: true });
    await writeFile(
      path.join(parentDir, "summary.json"),
      JSON.stringify({
        info: { id: parentId, cwd: "/tmp/meta-demo" },
        generated_title: "Parent",
        updated_at: "2026-08-09T12:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(childDir, "summary.json"),
      JSON.stringify({
        info: { id: childId, cwd: "/tmp/meta-demo" },
        generated_title: "Child",
        session_kind: "subagent",
        updated_at: "2026-08-09T11:00:00.000Z",
      }),
    );
    // Corrupt meta.json — should fall back to directory name.
    await writeFile(
      path.join(parentDir, "subagents", childId, "meta.json"),
      "{not-json",
    );

    const rows = await listSessionsFromDisk({ grokHome, limit: 50 });
    assert.equal(rows.length, 2);
    const child = rows.find((r) => r.id === childId);
    assert.equal(child?.parentSessionId, parentId);

    // Session without subagents/ still lists fine.
    const aloneRoot = await mkdtemp(path.join(tmpdir(), "grok-sessions-alone-"));
    const aloneEnc = encodeURIComponent("/tmp/alone");
    const aloneId = "019fe300-0000-7000-8000-000000000001";
    await mkdir(path.join(aloneRoot, "sessions", aloneEnc, aloneId), {
      recursive: true,
    });
    await writeFile(
      path.join(aloneRoot, "sessions", aloneEnc, aloneId, "summary.json"),
      JSON.stringify({
        info: { id: aloneId, cwd: "/tmp/alone" },
        generated_title: "Alone",
        updated_at: "2026-08-09T12:00:00.000Z",
      }),
    );
    const aloneRows = await listSessionsFromDisk({
      grokHome: aloneRoot,
      limit: 10,
    });
    assert.equal(aloneRows.length, 1);
    assert.equal(aloneRows[0]?.parentSessionId, undefined);
  });

  it("sessionsList mapping exposes sessionKind and parentSessionId", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-sessions-map-"));
    const sessionsRoot = path.join(root, "sessions");
    const wsEnc = encodeURIComponent("/tmp/map-demo");
    const parentId = "019fe400-0000-7000-8000-000000000001";
    const childId = "019fe400-0000-7000-8000-000000000002";
    const parentDir = path.join(sessionsRoot, wsEnc, parentId);
    const childDir = path.join(sessionsRoot, wsEnc, childId);
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    await mkdir(path.join(parentDir, "subagents", childId), { recursive: true });
    await writeFile(
      path.join(parentDir, "summary.json"),
      JSON.stringify({
        info: { id: parentId, cwd: "/tmp/map-demo" },
        generated_title: "Map parent",
        updated_at: "2026-08-09T12:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(childDir, "summary.json"),
      JSON.stringify({
        info: { id: childId, cwd: "/tmp/map-demo" },
        generated_title: "Map child",
        session_kind: "subagent_fork",
        updated_at: "2026-08-09T11:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(parentDir, "subagents", childId, "meta.json"),
      JSON.stringify({ child_session_id: childId }),
    );

    const prevHome = process.env.GROK_HOME;
    process.env.GROK_HOME = root;
    try {
      const result = (await sessionsList()) as {
        sessions?: Array<Record<string, unknown>>;
      };
      const sessions = result.sessions ?? [];
      assert.ok(sessions.length >= 2);
      const child = sessions.find((s) => s.id === childId);
      assert.equal(child?.sessionKind, "subagent_fork");
      assert.equal(child?.parentSessionId, parentId);
    } finally {
      if (prevHome === undefined) {
        delete process.env.GROK_HOME;
      } else {
        process.env.GROK_HOME = prevHome;
      }
    }
  });
});
