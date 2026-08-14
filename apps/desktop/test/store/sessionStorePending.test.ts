/**
 * Pending buffer claim / promote / debounce. Fan-out children stay out of
 * the catalog until spawn or sessions_list proves them.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import {
  cancelPendingSessionsSync,
  claimPendingAsChildren,
  PENDING_SYNC_QUIET_MS,
  promotePendingToCatalog,
  schedulePendingSessionsSync,
} from "@/store/sessionStorePending";
import { stampProvenance } from "@/store/sessionProvenance";
import type { SessionRoleIndex } from "@/store/sessionRoles";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { LiveHandle } from "@/store/sessionStoreLiveTypes";

/**
 * Session buffer with a real user line so catalog prune keeps the row.
 * @param id Session id.
 * @param text User prompt used as title + timeline body.
 */
function pendingState(id: string, text: string): SessionState {
  const state = createSessionState({ id, workspace: "/w" });
  return {
    ...state,
    title: text,
    timeline: [
      { id: `${id}-u`, kind: "user", blocks: [{ type: "text", text }] },
    ],
  };
}

afterEach(() => {
  // Drop a debounce timer so later files do not inherit a pending fire.
  cancelPendingSessionsSync();
});

describe("promotePendingToCatalog", () => {
  it("upserts the buffer and normalizes the matching row", () => {
    const state = pendingState("p1", "hello from pending");
    const catalog = promotePendingToCatalog([], state, 1_000);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.id, "p1");
    assert.match(catalog[0]?.title ?? "", /hello from pending/);
  });
});

describe("claimPendingAsChildren", () => {
  it("moves matching pending ids into childSessions and stamps child", () => {
    const pending: Record<string, SessionState> = {
      c1: pendingState("c1", "child one"),
      stray: pendingState("stray", "still unproven"),
    };
    const roles: SessionRoleIndex = {
      c1: { parentSessionId: "parent", sessionKind: "subagent" },
      c2: { parentSessionId: "parent", sessionKind: "subagent" },
    };
    const next = claimPendingAsChildren(pending, ["c1", "stray"], {}, roles, {});
    assert.equal(next.pending.c1, undefined);
    assert.ok(next.pending.stray);
    assert.deepEqual(next.order, ["stray"]);
    assert.equal(next.childSessions.c1?.id, "c1");
    assert.equal(next.provenance.c1, "child");
    // Role-only ids (no buffer yet) still get child provenance.
    assert.equal(next.provenance.c2, "child");
    assert.equal(next.provenance.stray, undefined);
  });

  it("is a no-op when roles is empty", () => {
    const pending = { c1: pendingState("c1", "keep") };
    const next = claimPendingAsChildren(pending, ["c1"], {}, {}, {});
    assert.equal(next.pending.c1?.id, "c1");
    assert.deepEqual(next.order, ["c1"]);
    assert.deepEqual(next.childSessions, {});
  });
});

describe("schedulePendingSessionsSync", () => {
  it("does not arm a timer when pending is empty", () => {
    let calls = 0;
    schedulePendingSessionsSync(
      {} as LiveHandle,
      () => undefined,
      () => ({ pendingSessions: {} }),
      async () => {
        calls += 1;
      },
    );
    assert.equal(calls, 0);
  });

  it("cancelPendingSessionsSync prevents a later fire", async () => {
    let calls = 0;
    const pending = { w1: pendingState("w1", "wire") };
    schedulePendingSessionsSync(
      {} as LiveHandle,
      () => undefined,
      () => ({ pendingSessions: pending }),
      async () => {
        calls += 1;
      },
    );
    cancelPendingSessionsSync();
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    assert.equal(calls, 0);
    assert.ok(PENDING_SYNC_QUIET_MS >= 1000);
  });

  it("second schedule while a timer is armed is a no-op", () => {
    let calls = 0;
    const get = () => ({
      pendingSessions: { w1: pendingState("w1", "wire") } as Record<
        string,
        SessionState
      >,
    });
    const syncFn = async () => {
      calls += 1;
    };
    schedulePendingSessionsSync({} as LiveHandle, () => undefined, get, syncFn);
    schedulePendingSessionsSync({} as LiveHandle, () => undefined, get, syncFn);
    cancelPendingSessionsSync();
    assert.equal(calls, 0);
  });
});

describe("promotePendingToCatalog existing row", () => {
  it("does not drop an already-catalogued sibling", () => {
    const existing: SessionRecord[] = [
      {
        id: "keep",
        workspace: "/w",
        title: "Keep me",
        mode: "build",
        model: "",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        timeline: [
          { id: "u", kind: "user", blocks: [{ type: "text", text: "keep" }] },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    ];
    const next = promotePendingToCatalog(
      existing,
      pendingState("new", "new chat"),
      3,
    );
    assert.ok(next.some((row) => row.id === "keep"));
    assert.ok(next.some((row) => row.id === "new"));
  });
});

describe("stampProvenance used by claim", () => {
  it("claim overwrites prior wire-absent index with child", () => {
    const prior = stampProvenance({}, "c1", "local");
    const next = claimPendingAsChildren(
      { c1: pendingState("c1", "race") },
      ["c1"],
      {},
      { c1: { parentSessionId: "p", sessionKind: "subagent" } },
      prior,
    );
    assert.equal(next.provenance.c1, "child");
  });
});
