/**
 * Unit tests for plan rail pure helpers (labels + progress).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planEntryLabel,
  planProgress,
  planStatusLabel,
} from "../../src/lib/planPanel";

describe("planStatusLabel", () => {
  it("maps known statuses to short UI labels", () => {
    assert.equal(planStatusLabel("completed"), "Done");
    assert.equal(planStatusLabel("in_progress"), "In progress");
    assert.equal(planStatusLabel("pending"), "Pending");
  });

  it("spaces unknown snake_case statuses", () => {
    assert.equal(planStatusLabel("blocked_by_user"), "blocked by user");
  });
});

describe("planEntryLabel", () => {
  it("prefers title over content", () => {
    assert.equal(
      planEntryLabel({ title: "A", content: "B" }, 1),
      "A",
    );
  });

  it("falls back to content then step number", () => {
    assert.equal(planEntryLabel({ content: "  body  " }, 2), "body");
    assert.equal(planEntryLabel({}, 3), "Step 3");
  });
});

describe("planProgress", () => {
  it("counts completed steps", () => {
    assert.deepEqual(
      planProgress([
        { status: "completed" },
        { status: "in_progress" },
        { status: "pending" },
        { status: "completed" },
      ]),
      { done: 2, total: 4 },
    );
  });

  it("treats missing status as not done", () => {
    assert.deepEqual(planProgress([{}, { status: "completed" }]), {
      done: 1,
      total: 2,
    });
  });
});
