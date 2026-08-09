import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterOverviewSessions,
  groupByOverviewStatus,
  toOverviewStatus,
} from "@/lib/multiSession";

describe("multiSession", () => {
  it("maps waiting_permission to needs_input", () => {
    assert.equal(
      toOverviewStatus({
        id: "1",
        title: "t",
        workspace: "/w",
        status: "waiting_permission",
      }),
      "needs_input",
    );
  });

  it("groups by status", () => {
    const g = groupByOverviewStatus([
      { id: "a", title: "A", workspace: "/w", status: "streaming" },
      { id: "b", title: "B", workspace: "/w", status: "idle", live: true },
      {
        id: "c",
        title: "C",
        workspace: "/w",
        status: "waiting_permission",
      },
    ]);
    assert.equal(g.working.length, 1);
    assert.equal(g.idle.length, 1);
    assert.equal(g.needs_input.length, 1);
  });

  it("filters s:working and free text", () => {
    const rows = [
      { id: "1", title: "Fix", workspace: "/demo", status: "streaming" as const },
      { id: "2", title: "Other", workspace: "/demo", status: "idle" as const },
    ];
    assert.equal(filterOverviewSessions(rows, "s:working").length, 1);
    assert.equal(filterOverviewSessions(rows, "fix").length, 1);
  });
});
