/**
 * Session role index: live subagents, remote rows, retro-tag, merge.
 * Pure helpers — no store wiring.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import {
  mergeRoles,
  rolesFromCatalog,
  rolesFromRemoteRows,
  rolesFromSubagents,
  retroTagCatalogRoles,
} from "@/store/sessionRoles";

const PARENT = "parent-roles";
const CHILDREN = ["child-a", "child-b", "child-c", "child-d"] as const;

/**
 * Minimal catalog row for role tests.
 * @param id Session id.
 * @param extra Optional fields.
 */
function row(
  id: string,
  extra: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    id,
    workspace: extra.workspace ?? "/proj",
    title: extra.title ?? id,
    mode: "build",
    model: "grok-4.5",
    status: "idle",
    createdAt: 1,
    updatedAt: extra.updatedAt ?? 1,
    timeline: extra.timeline ?? [],
    toolCalls: {},
    lastAgentText: "",
    ...extra,
  };
}

describe("rolesFromSubagents", () => {
  it("indexes 4 child ids under the parent after spawn cards exist", () => {
    const state = createSessionState({ id: PARENT, workspace: "/proj" });
    state.subagents = Object.fromEntries(
      CHILDREN.map((id, i) => [
        id,
        {
          subagentId: id,
          childSessionId: id,
          parentPromptId: "p1",
          type: "general-purpose",
          description: `d${i}`,
          status: "running",
        },
      ]),
    );
    const roles = rolesFromSubagents(state);
    assert.equal(Object.keys(roles).length, 4);
    for (const id of CHILDREN) {
      assert.equal(roles[id]?.parentSessionId, PARENT);
      assert.equal(roles[id]?.sessionKind, "subagent");
    }
  });
});

describe("rolesFromRemoteRows + mergeRoles", () => {
  it("disk and live indexes merge without mutual wipe", () => {
    const live = rolesFromSubagents({
      ...createSessionState({ id: PARENT }),
      subagents: {
        "child-live": {
          subagentId: "child-live",
          childSessionId: "child-live",
          type: "general-purpose",
          description: "live",
          status: "running",
        },
      },
    });
    const disk = rolesFromRemoteRows([
      {
        id: "child-disk",
        title: "old",
        sessionKind: "subagent",
        parentSessionId: PARENT,
      },
      {
        id: "ordinary",
        title: "chat",
      },
    ]);
    const merged = mergeRoles(disk, live);
    assert.equal(merged["child-live"]?.parentSessionId, PARENT);
    assert.equal(merged["child-disk"]?.parentSessionId, PARENT);
    assert.equal(merged.ordinary, undefined);
  });
});

describe("retroTagCatalogRoles", () => {
  it("tags a child row that was created before subagent_spawned", () => {
    // Out-of-order: child frame arrived first → catalog row without kind.
    const catalog = [
      row(PARENT, {
        timeline: [
          {
            kind: "user",
            id: "u1",
            blocks: [{ type: "text", text: "parent" }],
          },
        ],
        updatedAt: 100,
      }),
      row("child-a", {
        title: "you are the child prompt…",
        workspace: "",
        noProject: true,
        updatedAt: 200,
      }),
    ];
    const roles = {
      "child-a": {
        parentSessionId: PARENT,
        sessionKind: "subagent" as const,
      },
    };
    const tagged = retroTagCatalogRoles(catalog, roles, {
      [PARENT]: "/proj",
    });
    const child = tagged.find((r) => r.id === "child-a");
    assert.ok(child);
    assert.equal(child!.sessionKind, "subagent");
    assert.equal(child!.parentSessionId, PARENT);
    assert.equal(child!.workspace, "/proj");
    assert.equal(child!.noProject, false);

    // Rail filter hides the tagged child.
    const rail = filterCatalogForSessionRail(tagged);
    assert.equal(rail.some((r) => r.id === "child-a"), false);
    assert.equal(rail.some((r) => r.id === PARENT), true);
  });
});

describe("rolesFromCatalog", () => {
  it("rebuilds index from sessionKind and parent subagents", () => {
    const catalog = [
      row(PARENT, {
        subagents: {
          "child-from-card": {
            subagentId: "child-from-card",
            childSessionId: "child-from-card",
            type: "general-purpose",
            description: "x",
            status: "completed",
          },
        },
      }),
      row("child-kind", {
        sessionKind: "subagent",
        parentSessionId: PARENT,
      }),
    ];
    const roles = rolesFromCatalog(catalog);
    assert.equal(roles["child-from-card"]?.parentSessionId, PARENT);
    assert.equal(roles["child-kind"]?.parentSessionId, PARENT);
  });
});
