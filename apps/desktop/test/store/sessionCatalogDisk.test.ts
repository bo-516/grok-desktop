/**
 * Disk membership: successful sessions_list replaces the rail.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogKeepIds,
  catalogListUnchanged,
  reconcileCatalogWithDisk,
  stabilizeCatalogView,
} from "@/store/sessionCatalogDisk";
import type { SessionRecord } from "@/store/sessionCatalogTypes";

/**
 * Thin catalog row. Timeline stays empty unless a test fills it.
 * @param id Session id.
 * @param title Rail title.
 */
function row(id: string, title: string): SessionRecord {
  return {
    id,
    workspace: "/w",
    title,
    mode: "build",
    model: "",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

describe("reconcileCatalogWithDisk", () => {
  it("removes ids missing from a non-empty disk list", () => {
    const next = reconcileCatalogWithDisk(
      [row("keep", "Keep"), row("gone", "Gone")],
      [{ id: "keep", title: "Keep", workspace: "/w" }],
      new Set(),
    );
    assert.deepEqual(
      next.map((rec) => rec.id),
      ["keep"],
    );
  });

  it("clears the catalog when disk returns no rows and nothing is live", () => {
    const next = reconcileCatalogWithDisk(
      [row("gone", "Gone")],
      [],
      new Set(),
    );
    assert.equal(next.length, 0);
  });

  it("keeps a live id that disk has not listed yet", () => {
    const next = reconcileCatalogWithDisk(
      [row("live", "Live"), row("gone", "Gone")],
      [],
      new Set(["live"]),
    );
    assert.deepEqual(
      next.map((rec) => rec.id),
      ["live"],
    );
  });

  it("keeps the in-memory timeline and fills a weak title from disk", () => {
    const local = row("keep", "Chat 019fd68e");
    local.timeline = [
      { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
    ];
    const next = reconcileCatalogWithDisk(
      [local],
      [
        {
          id: "keep",
          title: "From disk",
          workspace: "/w",
          updatedAt: "2026-08-09T12:00:00.000Z",
        },
      ],
      new Set(),
    );
    assert.equal(next[0]?.title, "From disk");
    assert.equal(next[0]?.timeline.length, 1);
  });
});

describe("catalogKeepIds", () => {
  it("keeps pending, live pool, and a busy canvas only", () => {
    const keep = catalogKeepIds({
      pendingSessionIds: ["pend"],
      poolEntries: [
        { sessionId: "pool", live: true },
        { sessionId: "dead", live: false },
      ],
      creatingSession: false,
      sessionId: "canvas",
      sessionStatus: "idle",
    });
    assert.equal(keep.has("pend"), true);
    assert.equal(keep.has("pool"), true);
    assert.equal(keep.has("dead"), false);
    assert.equal(keep.has("canvas"), false);
  });

  it("keeps the canvas id while it is streaming", () => {
    const keep = catalogKeepIds({
      sessionId: "canvas",
      sessionStatus: "streaming",
    });
    assert.equal(keep.has("canvas"), true);
  });
});

describe("catalogListUnchanged", () => {
  it("is false when an id disappears", () => {
    assert.equal(
      catalogListUnchanged([row("a", "A"), row("b", "B")], [row("a", "A")]),
      false,
    );
  });

  it("ignores an updatedAt bump that stays in the same relative label", () => {
    const now = Date.UTC(2026, 9, 7);
    const day = 24 * 60 * 60 * 1000;
    const older = row("a", "A");
    older.updatedAt = now - 40 * day;
    const newer = row("a", "A");
    newer.updatedAt = now - 50 * day;
    assert.equal(catalogListUnchanged([older], [newer], now), true);
  });

  it("is false when the relative label would change", () => {
    const now = Date.UTC(2026, 9, 7);
    const day = 24 * 60 * 60 * 1000;
    const month = row("a", "A");
    month.updatedAt = now - 40 * day;
    const week = row("a", "A");
    week.updatedAt = now - 10 * day;
    assert.equal(catalogListUnchanged([month], [week], now), false);
  });
});

describe("stabilizeCatalogView", () => {
  it("returns the same array when the rail would not change", () => {
    const now = Date.UTC(2026, 9, 7);
    const day = 24 * 60 * 60 * 1000;
    const prev = [row("a", "A")];
    prev[0]!.updatedAt = now - 40 * day;
    const next = [row("a", "A")];
    next[0]!.updatedAt = now - 50 * day;
    assert.equal(stabilizeCatalogView(prev, next, now), prev);
  });

  it("reuses unchanged row objects when one title changes", () => {
    const prev = [row("a", "A"), row("b", "B")];
    const changed = row("b", "B2");
    const settled = stabilizeCatalogView(prev, [row("a", "A"), changed]);
    assert.equal(settled[0], prev[0]);
    assert.equal(settled[1], changed);
  });
});
