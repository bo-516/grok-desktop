/**
 * userPromptsStore: cli payloads, rollback, foreign guard (U-01..U-08).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  coercePromptsSnapshot,
  useUserPromptsStore,
  type PromptsSnapshot,
} from "@/store/userPromptsStore";
import type { PromptEntry } from "@/lib/userPrompts";

function emptyScope(
  scope: "global" | "project" | "projectLocal",
  path: string,
): PromptsSnapshot["global"] {
  return {
    scope,
    path,
    exists: false,
    foreign: false,
    entries: [],
    bytes: 0,
  };
}

function baseSnap(overrides?: Partial<PromptsSnapshot>): PromptsSnapshot {
  return {
    projectRoot: "/proj",
    gitRepo: true,
    localExcluded: false,
    global: emptyScope("global", "/gh/rules/00-grok-desktop.md"),
    project: emptyScope("project", "/proj/.grok/rules/00-grok-desktop.md"),
    projectLocal: emptyScope(
      "projectLocal",
      "/proj/.grok/rules/01-grok-desktop.local.md",
    ),
    ...overrides,
  };
}

function entry(text: string, id = "e0"): PromptEntry {
  return { id, text, enabled: true };
}

beforeEach(() => {
  useUserPromptsStore.setState({
    snapshot: baseSnap(),
    status: "ready",
    error: null,
    pending: {},
  });
});

describe("userPromptsStore", () => {
  it("U-01..04: set/clear payloads; add funnels to prompts_set", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const runCli = async (
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ command, args });
      if (command === "prompts_get") {
        return { ok: true, data: baseSnap() };
      }
      return { ok: true, data: { scope: "global", path: "p", bytes: 1, removed: false } };
    };

    const entries = [entry("hello")];
    const ok = await useUserPromptsStore
      .getState()
      .setScope(runCli, "global", entries);
    assert.equal(ok, true);
    assert.ok(
      calls.some(
        (c) =>
          c.command === "prompts_set" &&
          c.args?.scope === "global" &&
          Array.isArray(c.args?.entries),
      ),
    );

    calls.length = 0;
    await useUserPromptsStore.getState().clearScope(runCli, "project");
    assert.ok(
      calls.some(
        (c) => c.command === "prompts_clear" && c.args?.scope === "project",
      ),
    );
  });

  it("U-05: write failure rolls back snapshot and sets error", async () => {
    const before = useUserPromptsStore.getState().snapshot;
    const runCli = async (command: string) => {
      if (command === "prompts_set") {
        return { ok: false, error: "disk full" };
      }
      return { ok: true, data: {} };
    };
    const ok = await useUserPromptsStore
      .getState()
      .setScope(runCli, "global", [entry("x")]);
    assert.equal(ok, false);
    const st = useUserPromptsStore.getState();
    assert.equal(st.error, "disk full");
    assert.deepEqual(st.snapshot, before);
    assert.equal(st.pending.global, undefined);
  });

  it("U-06: successful write with live session sets restartNotice", async () => {
    // Lazy import session store so we can seed a live session id.
    const { useSessionStore } = await import("@/store/sessionStore");
    useSessionStore.setState({
      connectionMode: "live-bridge",
      session: {
        ...useSessionStore.getState().session,
        id: "sess-live-1",
      },
      restartNotice: null,
    });

    const runCli = async (command: string) => {
      if (command === "prompts_get") {
        return { ok: true, data: baseSnap() };
      }
      return { ok: true, data: {} };
    };
    await useUserPromptsStore
      .getState()
      .setScope(runCli, "global", [entry("live")]);
    const notice = useSessionStore.getState().restartNotice;
    assert.ok(notice && notice.includes("提示词"));
  });

  it("U-07: load refreshes project layers via prompts_get", async () => {
    const snap2 = baseSnap({
      project: {
        ...emptyScope("project", "/other/.grok/rules/00-grok-desktop.md"),
        exists: true,
        entries: [entry("proj", "p1")],
      },
    });
    const runCli = async (command: string) => {
      assert.equal(command, "prompts_get");
      return { ok: true, data: snap2 };
    };
    await useUserPromptsStore.getState().load(runCli, { force: true });
    const st = useUserPromptsStore.getState();
    assert.equal(st.snapshot?.project.entries[0]?.text, "proj");
    assert.equal(st.snapshot?.global.entries.length, 0);
  });

  it("U-08: foreign scope refuses set without runCli", async () => {
    useUserPromptsStore.setState({
      snapshot: baseSnap({
        global: {
          ...emptyScope("global", "/gh/rules/00-grok-desktop.md"),
          exists: true,
          foreign: true,
        },
      }),
    });
    let called = false;
    const runCli = async () => {
      called = true;
      return { ok: true, data: {} };
    };
    const ok = await useUserPromptsStore
      .getState()
      .setScope(runCli, "global", [entry("nope")]);
    assert.equal(ok, false);
    assert.equal(called, false);
  });

  it("coercePromptsSnapshot accepts bridge shape", () => {
    const snap = coercePromptsSnapshot(baseSnap());
    assert.ok(snap);
    assert.equal(snap!.gitRepo, true);
  });
});
