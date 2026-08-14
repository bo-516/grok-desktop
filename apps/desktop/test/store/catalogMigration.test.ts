/**
 * Catalog v1 → v2 migration: untagged child ghosts hide from rail without
 * deletion; selectSession still resolves; migration is idempotent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canSelectCatalogSession,
  filterCatalogForSessionRail,
} from "@/lib/sessionActions";
import {
  migrateCatalogV1toV2,
  migrateCatalogToCurrent,
} from "@/store/sessionCatalogMigration";
import {
  buildV1GhostCatalog,
  loadFanoutOrders,
} from "../helpers/fanoutProbe.js";
import type { SessionRecord } from "@/store/sessionCatalogTypes";

describe("catalog migration v1 → v2", () => {
  const meta = loadFanoutOrders();

  it("v1 ghost catalog → rail shows only user sessions after migrate", () => {
    const v1 = buildV1GhostCatalog(meta);
    assert.equal(filterCatalogForSessionRail(v1).length, 5);

    const { catalog, needsProbe } = migrateCatalogV1toV2(v1);
    const rail = filterCatalogForSessionRail(catalog);
    assert.equal(rail.length, 1, `rail should be parent-only, got ${rail.length}`);
    assert.equal(rail[0]?.id, meta.parentSessionId);
    // Rows not deleted.
    assert.equal(catalog.length, v1.length);
    // Ghost children demoted via clue (2) need probe.
    assert.ok(needsProbe.length >= meta.childSessionIds.length - 0);
  });

  it("migration does not delete rows: selectSession(childId) still resolves", () => {
    const v1 = buildV1GhostCatalog(meta);
    const { catalog } = migrateCatalogV1toV2(v1);
    for (const cid of meta.childSessionIds) {
      assert.ok(
        canSelectCatalogSession(catalog, cid),
        `child ${cid} must remain selectable`,
      );
    }
  });

  it("migration is idempotent: run twice → identical", () => {
    const v1 = buildV1GhostCatalog(meta);
    const first = migrateCatalogToCurrent(v1).catalog;
    const second = migrateCatalogToCurrent(first).catalog;
    assert.equal(second.length, first.length);
    for (let i = 0; i < first.length; i++) {
      assert.equal(second[i]?.id, first[i]?.id);
      assert.equal(second[i]?.sessionKind, first[i]?.sessionKind);
      assert.equal(second[i]?.schemaVersion, first[i]?.schemaVersion);
    }
  });

  it("clue (1): child listed in parent subagents snapshot is tagged", () => {
    const parentId = "p-with-snap";
    const childId = "c-from-snap";
    const catalog: SessionRecord[] = [
      {
        id: parentId,
        workspace: "/w",
        title: "parent",
        mode: "build",
        model: "",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        timeline: [
          { id: "u", kind: "user", blocks: [{ type: "text", text: "go" }] },
        ],
        toolCalls: {},
        lastAgentText: "",
        subagents: {
          sa: {
            subagentId: "sa",
            childSessionId: childId,
            status: "completed",
            type: "general-purpose",
            description: "w",
          },
        },
      },
      {
        id: childId,
        workspace: "",
        title: "untagged child",
        mode: "build",
        model: "",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
        noProject: true,
      },
    ];
    const { catalog: next } = migrateCatalogV1toV2(catalog);
    const child = next.find((r) => r.id === childId);
    assert.ok(child);
    assert.equal(child?.sessionKind, "subagent");
    assert.equal(child?.parentSessionId, parentId);
    assert.equal(filterCatalogForSessionRail(next).length, 1);
  });
});
