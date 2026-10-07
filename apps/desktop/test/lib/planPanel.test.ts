/**
 * Unit tests for plan rail pure helpers (labels + progress + row keys).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planEntryLabel,
  planProgress,
  planRows,
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

describe("planRows", () => {
  it("derives step, status, label, and a content key per entry", () => {
    const rows = planRows([
      { title: "Read", status: "completed" },
      { content: "Write" },
    ]);
    assert.deepEqual(
      rows.map(({ key, step, status, label }) => ({ key, step, status, label })),
      [
        { key: "completed|Read|", step: 1, status: "completed", label: "Read" },
        { key: "pending|Write|Write", step: 2, status: "pending", label: "Write" },
      ],
    );
  });

  it("keeps keys unique for identical steps and suffix look-alikes", () => {
    const rows = planRows([
      { content: "x" },
      { content: "x" },
      // Base key equals the suffixed key of the repeat above.
      { title: "x", content: "x#1" },
      { content: "x" },
    ]);
    assert.deepEqual(
      rows.map((r) => r.key),
      ["pending|x|x", "pending|x|x#1", "pending|x|x#1#1", "pending|x|x#2"],
    );
  });

  it("returns an empty list for no entries", () => {
    assert.deepEqual(planRows([]), []);
  });
});
