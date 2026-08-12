import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForkCommand,
  buildRewindCommand,
  canSelectCatalogSession,
  filterCatalogForSessionRail,
  isSubagentSessionKind,
  mergeRemoteSessionsIntoCatalog,
  normalizeOneSession,
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
    sessionKind: partial.sessionKind,
    parentSessionId: partial.parentSessionId,
    noProject: partial.noProject,
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

  it("mergeRemoteSessionsIntoCatalog keeps no-project rows unfiled", () => {
    // Disk files these under the bridge's own cwd; backfilling that path moved
    // the chat into a real project folder on the next sync (rail lost it).
    const local = [
      localRec({
        id: "unfiled",
        title: "Ask without a project",
        workspace: "",
        noProject: true,
        updatedAt: 10,
      }),
    ];
    const merged = mergeRemoteSessionsIntoCatalog(local, [
      {
        id: "unfiled",
        title: "Ask without a project",
        workspace: "/Users/me/grok-desktop",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
    ]);
    assert.equal(merged[0]?.workspace, "");
    assert.equal(merged[0]?.noProject, true);
  });

  it("mergeRemoteSessionsIntoCatalog leaves catalog alone on empty remote", () => {
    const local = [localRec({ id: "only", title: "Keep me", updatedAt: 9 })];
    const merged = mergeRemoteSessionsIntoCatalog(local, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "only");
  });

  it("normalizeOneSession accepts camelCase and snake_case role fields", () => {
    const camel = normalizeOneSession({
      id: "c1",
      title: "Child",
      sessionKind: "subagent",
      parentSessionId: "p1",
    });
    assert.equal(camel?.sessionKind, "subagent");
    assert.equal(camel?.parentSessionId, "p1");
    const snake = normalizeOneSession({
      id: "c2",
      title: "Resume",
      session_kind: "subagent_resume",
      parent_session_id: "p2",
    });
    assert.equal(snake?.sessionKind, "subagent_resume");
    assert.equal(snake?.parentSessionId, "p2");
  });

  it("mergeRemoteSessionsIntoCatalog backfills sessionKind on existing rows", () => {
    const local = [
      localRec({
        id: "child-1",
        title: "Goal plan writer",
        workspace: "/demo",
        updatedAt: 10,
      }),
    ];
    const merged = mergeRemoteSessionsIntoCatalog(local, [
      {
        id: "child-1",
        title: "Goal plan writer",
        workspace: "/demo",
        sessionKind: "subagent",
        parentSessionId: "parent-1",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
    ]);
    assert.equal(merged[0]?.sessionKind, "subagent");
    assert.equal(merged[0]?.parentSessionId, "parent-1");
  });

  it("isSubagentSessionKind uses prefix matching", () => {
    assert.equal(isSubagentSessionKind("subagent"), true);
    assert.equal(isSubagentSessionKind("subagent_fork"), true);
    assert.equal(isSubagentSessionKind(undefined), false);
    assert.equal(isSubagentSessionKind("main"), false);
  });

  it("filterCatalogForSessionRail hides subagents but keeps catalog selectable", () => {
    const catalog: SessionRecord[] = [
      localRec({ id: "user-1", title: "Normal chat", workspace: "/ws" }),
      localRec({
        id: "child-1",
        title: "Adversarial Verifier",
        workspace: "/ws",
        sessionKind: "subagent",
      }),
      localRec({
        id: "child-2",
        title: "Goal Plan Writer",
        workspace: "/ws",
        sessionKind: "subagent_resume",
      }),
      localRec({ id: "user-2", title: "Another chat", workspace: "/ws" }),
    ];
    const rail = filterCatalogForSessionRail(catalog);
    assert.equal(rail.length, 2);
    assert.deepEqual(
      rail.map((r) => r.id).sort(),
      ["user-1", "user-2"],
    );
    // Search still excludes subagents.
    const searched = filterCatalogForSessionRail(catalog, "goal");
    assert.equal(searched.length, 0);
    const searchedUser = filterCatalogForSessionRail(catalog, "another");
    assert.equal(searchedUser.length, 1);
    assert.equal(searchedUser[0]?.id, "user-2");
    // Drill-down: child id remains in full catalog.
    assert.equal(canSelectCatalogSession(catalog, "child-1"), true);
    assert.equal(canSelectCatalogSession(catalog, "missing"), false);
  });

  it("filterCatalogForSessionRail hides empty untitled drafts", () => {
    const catalog: SessionRecord[] = [
      localRec({
        id: "with-msgs",
        title: "Untitled chat",
        workspace: "/ws",
        timeline: [
          {
            kind: "user",
            id: "u1",
            blocks: [{ type: "text", text: "hello" }],
          },
        ],
      }),
      localRec({
        id: "empty-untitled",
        title: "Untitled chat",
        workspace: "/ws",
        timeline: [],
      }),
      localRec({
        id: "empty-chat-id",
        title: "Chat 019fd68e",
        workspace: "/ws",
        timeline: [],
      }),
      localRec({
        id: "remote-summary",
        title: "Count slowly from 1 to 100",
        workspace: "/ws",
        timeline: [],
      }),
    ];
    const rail = filterCatalogForSessionRail(catalog);
    assert.deepEqual(
      rail.map((r) => r.id).sort(),
      ["remote-summary", "with-msgs"],
    );
  });
});
