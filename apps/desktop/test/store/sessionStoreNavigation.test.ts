/**
 * Navigation selectSession must resolve catalogued childSessionIds (subagents).
 * Guards A4: filtering must not delete catalog rows or select early-returns.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSelectCatalogSession } from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalog";
import { readSrc } from "../helpers/sourceFiles.js";

/**
 * Minimal catalog row for navigation tests.
 * @param partial Overrides including required id.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "/ws",
    title: partial.title ?? partial.id,
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

describe("selectSession navigation for subagent drill-down", () => {
  it("catalogued childSessionId is selectable (no early-return solely for subagent kind)", () => {
    const childSessionId = "019feb2e-97ef-0000-0000-000000000001";
    const catalog = [
      rec({
        id: "019feb2e-5fe5-0000-0000-000000000001",
        title: "Parent goal chat",
      }),
      rec({
        id: childSessionId,
        title: "goal plan writer",
        sessionKind: "subagent",
        parentSessionId: "019feb2e-5fe5-0000-0000-000000000001",
      }),
    ];
    assert.equal(canSelectCatalogSession(catalog, childSessionId), true);
    // Production selectSessionAction: catalog.find then return if missing.
    const found = catalog.find((s) => s.id === childSessionId);
    assert.ok(found);
    assert.equal(found.sessionKind, "subagent");
  });

  it("selectSessionAction still gates only on catalog membership, not sessionKind", () => {
    const nav = readSrc("store/sessionStoreNavigation.ts");
    // Early-return is solely "not in catalog" — must not check sessionKind.
    assert.match(nav, /catalog\.find\(\(s\) => s\.id === id\)/);
    assert.doesNotMatch(nav, /sessionKind/);
    assert.match(nav, /if \(!rec\) \{\s*return;/s);
  });

  it("rail filter lives in product path and uses filterCatalogForSessionRail", () => {
    const rail = readSrc("widgets/sessionRail/useSessionRailWidget.ts");
    assert.match(rail, /filterCatalogForSessionRail/);
    assert.doesNotMatch(rail, /subagentVisibility/);
  });

  it("Tasks panel reads session.subagents not title-regex module", () => {
    const tasks = readSrc("widgets/TasksPanelWidget.tsx");
    assert.match(tasks, /session\.subagents/);
    assert.match(tasks, /listOrchestrationSubagentCards/);
    assert.doesNotMatch(tasks, /subagentVisibility|listSubagentCards/);
  });
});
