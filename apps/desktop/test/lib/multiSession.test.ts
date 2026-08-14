import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OVERVIEW_SESSION_DISPLAY_LIMIT,
  buildOverviewSessions,
  filterOverviewSessions,
  groupByOverviewStatus,
  limitOverviewSessions,
  resolveOverviewPaintStatus,
  toOverviewStatus,
} from "@/lib/multiSession";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal catalog row for Overview projection tests.
 * @param partial Overrides; `id` is required so callers name the row.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "/w",
    title: partial.title ?? `Chat ${partial.id}`,
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
  };
}

describe("multiSession", () => {
  it("maps live waiting_permission to needs_input", () => {
    assert.equal(
      toOverviewStatus({
        id: "1",
        title: "t",
        workspace: "/w",
        status: "waiting_permission",
        live: true,
      }),
      "needs_input",
    );
  });

  it("does not treat catalog streaming without live as working", () => {
    assert.equal(
      toOverviewStatus({
        id: "1",
        title: "t",
        workspace: "/w",
        status: "streaming",
      }),
      "idle",
    );
    assert.equal(
      toOverviewStatus({
        id: "2",
        title: "t",
        workspace: "/w",
        status: "waiting_permission",
      }),
      "idle",
    );
  });

  it("groups by healed live status", () => {
    const g = groupByOverviewStatus([
      { id: "a", title: "A", workspace: "/w", status: "streaming", live: true },
      { id: "b", title: "B", workspace: "/w", status: "idle", live: true },
      {
        id: "c",
        title: "C",
        workspace: "/w",
        status: "waiting_permission",
        live: true,
      },
      { id: "d", title: "D", workspace: "/w", status: "streaming" },
    ]);
    assert.equal(g.working.length, 1);
    assert.equal(g.working[0]?.id, "a");
    assert.equal(g.idle.length, 2);
    assert.equal(g.needs_input.length, 1);
  });

  it("filters s:working and free text", () => {
    const rows = [
      {
        id: "1",
        title: "Fix",
        workspace: "/demo",
        status: "streaming" as const,
        live: true,
      },
      { id: "2", title: "Other", workspace: "/demo", status: "idle" as const },
      {
        id: "3",
        title: "Stale",
        workspace: "/demo",
        status: "streaming" as const,
      },
    ];
    assert.equal(filterOverviewSessions(rows, "s:working").length, 1);
    assert.equal(filterOverviewSessions(rows, "fix").length, 1);
  });
});

describe("resolveOverviewPaintStatus", () => {
  it("keeps live pool streaming / permission", () => {
    assert.deepEqual(
      resolveOverviewPaintStatus("idle", {
        status: "streaming",
        live: true,
      }),
      { status: "streaming", live: true },
    );
    assert.deepEqual(
      resolveOverviewPaintStatus("idle", {
        status: "waiting_permission",
        live: true,
      }),
      { status: "waiting_permission", live: true },
    );
  });

  it("heals stale catalog streaming when the process is gone", () => {
    assert.deepEqual(resolveOverviewPaintStatus("streaming"), {
      status: "idle",
      live: undefined,
    });
    assert.deepEqual(resolveOverviewPaintStatus("waiting_permission"), {
      status: "idle",
      live: undefined,
    });
  });

  it("heals catalog streaming when the pool resident is idle", () => {
    assert.deepEqual(
      resolveOverviewPaintStatus("streaming", {
        status: "idle",
        live: true,
      }),
      { status: "idle", live: true },
    );
  });

  it("does not count a non-live pool streaming row as working", () => {
    assert.deepEqual(
      resolveOverviewPaintStatus("streaming", {
        status: "streaming",
        live: false,
      }),
      { status: "idle", live: false },
    );
  });
});

describe("buildOverviewSessions", () => {
  it("hides subagent catalog rows and role-only children", () => {
    const rows = buildOverviewSessions(
      [
        rec({ id: "parent", title: "Parent chat", status: "idle" }),
        rec({
          id: "child-kind",
          title: "你是「阿珍」",
          status: "streaming",
          sessionKind: "subagent",
        }),
        rec({
          id: "child-role",
          title: "你是一个角色扮演写作 agent",
          status: "streaming",
        }),
      ],
      [
        { sessionId: "child-kind", status: "streaming", live: true },
        { sessionId: "child-role", status: "streaming", live: true },
      ],
      {
        sessionRoles: {
          "child-role": { sessionKind: "subagent" },
        },
      },
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["parent"],
    );
  });

  it("paints WORKING only for live pool streaming user chats", () => {
    const rows = buildOverviewSessions(
      [
        rec({ id: "live", title: "Live fix", status: "idle" }),
        rec({ id: "stale", title: "Stale stream", status: "streaming" }),
      ],
      [{ sessionId: "live", status: "streaming", live: true }],
    );
    const live = rows.find((r) => r.id === "live");
    const stale = rows.find((r) => r.id === "stale");
    assert.equal(live?.status, "streaming");
    assert.equal(live?.live, true);
    assert.equal(toOverviewStatus(live!), "working");
    assert.equal(stale?.status, "idle");
    assert.equal(toOverviewStatus(stale!), "idle");
  });

  it("keeps Allow/Deny when the focused canvas is waiting_permission", () => {
    const rows = buildOverviewSessions(
      [rec({ id: "cur", title: "Needs ok", status: "idle" })],
      [{ sessionId: "cur", status: "idle", live: true }],
      { canvas: { id: "cur", status: "waiting_permission" } },
    );
    assert.equal(rows[0]?.pendingPermission, true);
    assert.equal(rows[0]?.status, "waiting_permission");
    assert.equal(toOverviewStatus(rows[0]!), "needs_input");
  });

  it("forwards catalog updatedAt for the display cap", () => {
    const rows = buildOverviewSessions(
      [rec({ id: "a", title: "A", updatedAt: 42 })],
      [],
    );
    assert.equal(rows[0]?.updatedAt, 42);
  });
});

describe("limitOverviewSessions", () => {
  it("returns all rows newest-first when under the cap", () => {
    const out = limitOverviewSessions([
      { id: "old", title: "Old", workspace: "/w", status: "idle", updatedAt: 1 },
      { id: "new", title: "New", workspace: "/w", status: "idle", updatedAt: 9 },
    ]);
    assert.deepEqual(
      out.map((r) => r.id),
      ["new", "old"],
    );
  });

  it("keeps only the newest 100 rows", () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({
      id: `s${String(i).padStart(3, "0")}`,
      title: `Chat ${i}`,
      workspace: "/w",
      status: "idle" as const,
      updatedAt: i,
    }));
    const out = limitOverviewSessions(rows);
    assert.equal(out.length, OVERVIEW_SESSION_DISPLAY_LIMIT);
    assert.equal(out[0]?.id, "s129");
    assert.equal(out[99]?.id, "s030");
  });

  it("breaks updatedAt ties by id and treats missing as oldest", () => {
    const out = limitOverviewSessions(
      [
        { id: "b", title: "B", workspace: "/w", status: "idle", updatedAt: 5 },
        { id: "a", title: "A", workspace: "/w", status: "idle", updatedAt: 5 },
        { id: "none", title: "None", workspace: "/w", status: "idle" },
      ],
      2,
    );
    assert.deepEqual(
      out.map((r) => r.id),
      ["a", "b"],
    );
  });

  it("returns empty when limit is not positive", () => {
    const rows = [
      { id: "a", title: "A", workspace: "/w", status: "idle", updatedAt: 1 },
    ];
    assert.deepEqual(limitOverviewSessions(rows, 0), []);
    assert.deepEqual(limitOverviewSessions(rows, -3), []);
  });
});
