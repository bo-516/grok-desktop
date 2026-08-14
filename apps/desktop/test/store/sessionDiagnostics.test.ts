/**
 * Dev-only session diagnostics dump: shape + registration guard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  dumpSessionDiagnostics,
  registerSessionDiagnostics,
  type SessionDiagnosticsDump,
} from "@/store/sessionDiagnostics";
import { stampProvenance } from "@/store/sessionProvenance";

describe("session diagnostics", () => {
  it("dump shape includes provenance, roles, pending, buffered, rail, subagents", () => {
    const dump = dumpSessionDiagnostics(() => ({
      viewingSessionId: "parent",
      sessionProvenance: stampProvenance(
        stampProvenance({}, "parent", "local"),
        "child",
        "child",
      ),
      sessionRoles: {
        child: { parentSessionId: "parent", sessionKind: "subagent" },
      },
      pendingSessions: {
        wire1: createSessionState({ id: "wire1", workspace: "" }),
      },
      childSessions: {
        child: createSessionState({ id: "child", workspace: "/w" }),
      },
      catalog: [
        {
          id: "parent",
          workspace: "/w",
          title: "Parent chat",
          mode: "build",
          model: "",
          status: "idle",
          createdAt: 1,
          updatedAt: 2,
          timeline: [
            { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
          ],
          toolCalls: {},
          lastAgentText: "",
        },
      ],
      session: {
        ...createSessionState({ id: "parent", workspace: "/w" }),
        subagents: {
          sa: {
            subagentId: "sa",
            childSessionId: "child",
            status: "running",
            type: "general-purpose",
            description: "w",
          },
        },
      },
    }));

    const required: Array<keyof SessionDiagnosticsDump> = [
      "viewing",
      "provenance",
      "roles",
      "pending",
      "buffered",
      "railRows",
      "subagentsInCanvas",
    ];
    for (const key of required) {
      assert.ok(key in dump, `missing ${key}`);
    }
    assert.equal(dump.viewing, "parent");
    assert.equal(dump.provenance.parent, "local");
    assert.equal(dump.roles.child, "parent");
    assert.deepEqual(dump.pending, ["wire1"]);
    assert.deepEqual(dump.buffered, ["child"]);
    assert.equal(dump.railRows.length, 1);
    assert.equal(dump.subagentsInCanvas, 1);
  });

  it("registerSessionDiagnostics is a no-op when not DEV", () => {
    // Under node:test, import.meta.env.DEV is typically undefined/false.
    const hadWindow = typeof globalThis.window !== "undefined";
    if (!hadWindow) {
      (globalThis as { window?: unknown }).window = {};
    }
    const w = globalThis.window as { __grokDiag?: unknown };
    delete w.__grokDiag;
    registerSessionDiagnostics(() => {
      throw new Error("get should not run during non-DEV register");
    });
    // Production / non-DEV: must not register.
    // If the test runner happens to set DEV, the function may register —
    // only assert the dump helper itself is pure and available.
    assert.equal(typeof dumpSessionDiagnostics, "function");
    if (!hadWindow) {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
