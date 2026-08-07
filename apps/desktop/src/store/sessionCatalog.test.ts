/**
 * Project grouping + title + upsert tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  groupSessionsByProject,
  isWeakSessionTitle,
  pickSessionTitle,
  projectNameFromWorkspace,
  pruneEmptyWeakSessions,
  rehydrateCatalogTitles,
  upsertFromLiveState,
} from "./sessionCatalog";

describe("sessionCatalog", () => {
  it("projectNameFromWorkspace uses basename", () => {
    assert.equal(
      projectNameFromWorkspace("/Users/me/code/grok-desktop/demo"),
      "demo",
    );
  });

  it("isWeakSessionTitle detects id placeholders", () => {
    assert.equal(isWeakSessionTitle("Session 019fd68e"), true);
    assert.equal(isWeakSessionTitle("session 019fd68e"), true);
    assert.equal(isWeakSessionTitle("Chat 019fd68e"), true);
    assert.equal(isWeakSessionTitle("Chat 019fd6c4"), true);
    assert.equal(
      isWeakSessionTitle("UI UX Design Agent Style Codex Claude"),
      false,
    );
    assert.equal(isWeakSessionTitle("Fix the average function"), false);
  });

  it("pickSessionTitle prefers user message over id", () => {
    const state = createSessionState({
      id: "019fd68e-1f9f-76c3-91d4-ed487503dc51",
      workspace: "/proj/demo",
    });
    state.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "Fix the average function" }],
      },
    ];
    assert.equal(
      pickSessionTitle({ state, existingTitle: "Session 019fd68e" }),
      "Fix the average function",
    );
  });

  it("upsert does not clobber rich timeline with empty handshake", () => {
    const rich = createSessionState({
      id: "s1",
      workspace: "/proj/demo",
    });
    rich.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "Hello world prompt" }],
      },
      { kind: "agent", id: "a1", text: "Hi there" },
    ];
    let cat = upsertFromLiveState([], rich, 1000);
    assert.equal(cat[0]?.title, "Hello world prompt");
    assert.equal(cat[0]?.timeline.length, 2);

    const empty = createSessionState({
      id: "s1",
      workspace: "/proj/demo",
    });
    cat = upsertFromLiveState(cat, empty, 2000);
    assert.equal(cat[0]?.timeline.length, 2);
    assert.equal(cat[0]?.title, "Hello world prompt");
  });

  it("rehydrateCatalogTitles fixes Chat id titles from timeline", () => {
    const fixed = rehydrateCatalogTitles([
      {
        id: "s1",
        workspace: "/p",
        title: "Chat 019aaaaa",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [
              {
                type: "text",
                text: "UI UX Design Agent Style Codex Claude",
              },
            ],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    assert.equal(fixed[0]?.title, "UI UX Design Agent Style Codex Claude");
  });

  it("rehydrateCatalogTitles keeps an agent session_info title", () => {
    const fixed = rehydrateCatalogTitles([
      {
        id: "s-agent-title",
        workspace: "/p",
        title: "Implement Composer Mentions",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [{ type: "text", text: "make the input better" }],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);

    assert.equal(fixed[0]?.title, "Implement Composer Mentions");
  });

  it("pruneEmptyWeakSessions drops reconnect ghosts", () => {
    const pruned = pruneEmptyWeakSessions([
      {
        id: "keep",
        workspace: "/proj/demo",
        title: "Grok Terminal UI Design Recreation",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 300,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [{ type: "text", text: "Grok Terminal UI Design Recreation" }],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "ghost1",
        workspace: "/proj/demo",
        title: "Chat 019aaaa",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 100,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "ghost2",
        workspace: "/proj/demo",
        title: "Chat 019bbbb",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 200,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    assert.equal(pruned.some((s) => s.id === "keep"), true);
    // only one empty weak kept (newest ghost2)
    const empties = pruned.filter((s) => s.timeline.length === 0);
    assert.equal(empties.length, 1);
    assert.equal(empties[0]?.id, "ghost2");
  });

  it("groupSessionsByProject clusters by workspace", () => {
    const groups = groupSessionsByProject([
      {
        id: "a",
        workspace: "/proj/demo",
        title: "A",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 100,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "b",
        workspace: "/proj/other",
        title: "B",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 200,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    assert.equal(groups[0]?.projectName, "other");
    assert.equal(groups[1]?.projectName, "demo");
  });
});
