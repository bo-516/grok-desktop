/**
 * Catalog goal merge must keep lastEventDetail across thin inbound snapshots.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoalSnapshot } from "@grok-desktop/acp-core";
import { mergeCatalogGoal } from "@/store/sessionCatalogUpsert";

/**
 * Minimal GoalSnapshot for merge tests; `goalId` is required, the rest default.
 * @param partial Overrides on top of zeroed counters / empty objective.
 * @returns A complete snapshot object.
 */
function goal(partial: Partial<GoalSnapshot> & { goalId: string }): GoalSnapshot {
  return {
    objective: "",
    status: "active",
    phase: "executing",
    totalDeliverables: 0,
    completedDeliverables: 0,
    workerRounds: 0,
    verifyRounds: 0,
    tokensUsed: 0,
    ...partial,
  };
}

describe("mergeCatalogGoal lastEventDetail", () => {
  it("keeps stored wrap-up when inbound omits it on the same goal", () => {
    const existing = goal({
      goalId: "g1",
      lastEvent: "worker_completed",
      lastEventDetail: "Worker finished.",
    });
    const inbound = goal({
      goalId: "g1",
      status: "user_paused",
      phase: "idle",
      lastEvent: "worker_completed",
    });
    const merged = mergeCatalogGoal(existing, inbound);
    assert.equal(merged?.status, "user_paused");
    assert.equal(merged?.lastEventDetail, "Worker finished.");
  });

  it("lets inbound replace the wrap-up and drops it on a new goal id", () => {
    const existing = goal({
      goalId: "g1",
      lastEventDetail: "Old wrap-up.",
    });
    const replaced = mergeCatalogGoal(
      existing,
      goal({ goalId: "g1", lastEventDetail: "New wrap-up." }),
    );
    assert.equal(replaced?.lastEventDetail, "New wrap-up.");
    const other = mergeCatalogGoal(
      existing,
      goal({ goalId: "g2", lastEvent: "goal_created" }),
    );
    assert.equal(other?.goalId, "g2");
    assert.equal(other?.lastEventDetail, undefined);
  });

  it("falls back to existing when inbound has no goal", () => {
    const existing = goal({ goalId: "g1", lastEventDetail: "Keep me." });
    assert.equal(mergeCatalogGoal(existing, undefined), existing);
  });
});
