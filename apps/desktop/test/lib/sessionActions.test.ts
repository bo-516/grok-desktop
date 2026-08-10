import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForkCommand,
  buildRewindCommand,
  mergeRemoteSessionsIntoCatalog,
  normalizeSessionsList,
  rewindConfirm,
  shareConfirm,
} from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal local catalog row for merge tests.
 * @param partial Overrides for the default idle row.
 */
function localRec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "",
    title: partial.title ?? `Chat ${partial.id.slice(0, 8)}`,
    mode: partial.mode ?? "build",
    model: partial.model ?? "",
    status: partial.status ?? "idle",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    timeline: partial.timeline ?? [],
    toolCalls: partial.toolCalls ?? {},
    lastAgentText: partial.lastAgentText ?? "",
  };
}

describe("sessionActions", () => {
  it("builds fork/rewind commands", () => {
    assert.equal(buildForkCommand(), "/fork");
    assert.equal(buildForkCommand("from here"), "/fork from here");
    assert.equal(buildRewindCommand(), "/rewind");
  });

  it("warns dirty git on rewind confirm", () => {
    const p = rewindConfirm(true);
    assert.match(p.details.join(" "), /Uncommitted/);
  });

  it("share confirm mentions code.grok.com", () => {
    assert.match(shareConfirm().details.join(" "), /code\.grok\.com/);
  });

  it("normalizes sessions list array with workspace", () => {
    const rows = normalizeSessionsList([
      { id: "abc", title: "Hello", cwd: "/proj/a" },
      { sessionId: "def", name: "X", workspace: "/proj/b" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, "abc");
    assert.equal(rows[0]?.workspace, "/proj/a");
    assert.equal(rows[1]?.workspace, "/proj/b");
  });

  it("mergeRemoteSessionsIntoCatalog upserts all workspaces and keeps local", () => {
    const local = [
      localRec({
        id: "keep-local",
        title: "Local only",
        workspace: "/local",
        updatedAt: 50,
        timeline: [
          {
            kind: "user",
            id: "u-keep-local",
            blocks: [{ type: "text", text: "hi" }],
          },
        ],
      }),
      localRec({
        id: "shared",
        // Weak id-placeholder title should be replaced by a strong remote title.
        title: "Chat 019fd68e",
        workspace: "",
        updatedAt: 10,
      }),
    ];
    const merged = mergeRemoteSessionsIntoCatalog(local, [
      {
        id: "shared",
        title: "Strong remote title",
        workspace: "/demo",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      {
        id: "other-ws",
        title: "Flow novel work",
        workspace: "/flow-novel",
        updatedAt: "2026-08-08T12:00:00.000Z",
      },
    ]);
    const byId = new Map(merged.map((r) => [r.id, r]));
    assert.ok(byId.has("keep-local"));
    assert.equal(byId.get("shared")?.workspace, "/demo");
    assert.equal(byId.get("shared")?.title, "Strong remote title");
    assert.equal(byId.get("other-ws")?.workspace, "/flow-novel");
    assert.equal(byId.get("other-ws")?.title, "Flow novel work");
  });

  it("mergeRemoteSessionsIntoCatalog leaves catalog alone on empty remote", () => {
    const local = [localRec({ id: "only", title: "Keep me", updatedAt: 9 })];
    const merged = mergeRemoteSessionsIntoCatalog(local, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "only");
  });
});
