/**
 * Field-ownership merge: exhaustive table + Go/Node snapshot shapes.
 * Drives the shipped mergeBridgeSnapshot (no re-implementation).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSessionFieldOwnerComplete,
  createSessionState,
  isEmptySessionField,
  mergeAvailableModelsPreferContext,
  mergeBridgeSnapshot,
  SESSION_FIELD_OWNER,
  type SessionState,
} from "../src/index.js";

/**
 * Fully-populated SessionState probe so runtime key checks cover every field.
 * Optional maps/scalars are set so Object.keys reflects the ownership surface.
 */
function fullProbe(): SessionState {
  return {
    id: "probe",
    workspace: "/w",
    model: "grok-4.5",
    mode: "build",
    status: "idle",
    timeline: [{ id: "t1", kind: "user", blocks: [{ type: "text", text: "hi" }] }],
    toolCalls: { c1: { id: "c1", title: "t", status: "completed" } as never },
    plan: [{ content: "step", status: "pending" }],
    pendingPermission: undefined,
    availableCommands: [],
    availableModels: [{ id: "m", totalContextTokens: 128000 }],
    title: "Title",
    updatedAt: "2026-01-01T00:00:00.000Z",
    configOptions: [],
    todos: [{ content: "todo", status: "pending" }],
    agentCapabilities: {},
    lastAgentText: "hello",
    errorMessage: undefined,
    tokenUsage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    },
    goal: {
      goalId: "g1",
      objective: "obj",
      status: "active",
      phase: "executing",
      totalDeliverables: 0,
      completedDeliverables: 0,
      workerRounds: 0,
      verifyRounds: 0,
      tokensUsed: 0,
    },
    subagents: {
      s1: {
        subagentId: "s1",
        childSessionId: "s1",
        type: "general-purpose",
        description: "a",
        status: "running",
      },
    },
    backgroundTasks: {
      t1: {
        taskId: "t1",
        command: "echo",
        status: "running",
      },
    },
    subagentLinks: { s1: "call-1" },
  };
}

/** Four subagent cards as after a multi-spawn reduce. */
function fourSubagents(): NonNullable<SessionState["subagents"]> {
  const cards: NonNullable<SessionState["subagents"]> = {};
  for (let i = 1; i <= 4; i += 1) {
    const id = `sub-${i}`;
    cards[id] = {
      subagentId: id,
      childSessionId: id,
      parentPromptId: "prompt-1",
      type: "general-purpose",
      description: `demo ${i}`,
      status: "running",
    };
  }
  return cards;
}

describe("SESSION_FIELD_OWNER completeness", () => {
  it("covers every key of a fully-populated SessionState probe", () => {
    const keys = assertSessionFieldOwnerComplete(fullProbe());
    assert.ok(keys.includes("subagents"));
    assert.ok(keys.includes("subagentLinks"));
    assert.ok(keys.includes("backgroundTasks"));
    assert.ok(keys.includes("goal"));
    assert.ok(keys.includes("todos"));
    assert.ok(keys.includes("tokenUsage"));
    // Owner table is the type-level exhaustive set; length must match Object.keys.
    assert.equal(keys.length, Object.keys(SESSION_FIELD_OWNER).length);
  });

  it("declares a rule for every keyof SessionState (compile + runtime)", () => {
    // If a key is missing from SESSION_FIELD_OWNER, TS fails at build time.
    // Runtime: every owner key is a known rule.
    for (const [k, rule] of Object.entries(SESSION_FIELD_OWNER)) {
      assert.ok(
        rule === "bridge" ||
          rule === "clientPreferNonEmpty" ||
          rule === "clientMergeMap",
        `bad rule for ${k}: ${rule}`,
      );
    }
  });
});

describe("isEmptySessionField", () => {
  it("treats undefined, null, empty string/array/object as empty", () => {
    assert.equal(isEmptySessionField(undefined), true);
    assert.equal(isEmptySessionField(null), true);
    assert.equal(isEmptySessionField(""), true);
    assert.equal(isEmptySessionField([]), true);
    assert.equal(isEmptySessionField({}), true);
    assert.equal(isEmptySessionField("x"), false);
    assert.equal(isEmptySessionField([1]), false);
    assert.equal(isEmptySessionField({ a: 1 }), false);
  });
});

describe("mergeBridgeSnapshot", () => {
  it("Go-shaped empty timeline leaves 4 client subagent cards intact", () => {
    const client = createSessionState({ id: "parent", workspace: "/proj" });
    client.timeline = [
      {
        id: "u1",
        kind: "user",
        blocks: [{ type: "text", text: "fan out" }],
      },
    ];
    client.subagents = fourSubagents();
    client.subagentLinks = {
      "sub-1": "call-1",
      "sub-2": "call-2",
      "sub-3": "call-3",
      "sub-4": "call-4",
    };
    client.goal = {
      goalId: "g1",
      objective: "fan out",
      status: "active",
      phase: "executing",
      totalDeliverables: 0,
      completedDeliverables: 0,
      workerRounds: 0,
      verifyRounds: 0,
      tokensUsed: 0,
    };
    client.backgroundTasks = {
      bg1: { taskId: "bg1", command: "sleep 1", status: "running" },
    };
    client.todos = [{ content: "keep me", status: "pending" }];
    client.tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    client.lastAgentText = "working";
    client.plan = [{ content: "step", status: "pending" }];
    client.title = "Parent chat";
    client.toolCalls = {
      "call-1": {
        id: "call-1",
        title: "spawn",
        status: "completed",
      } as never,
    };

    // Go emitState: lifecycle only, empty timeline, no orchestration fields.
    const bridge = createSessionState({ id: "parent", workspace: "/proj" });
    bridge.status = "streaming";
    bridge.model = "grok-4.5";
    bridge.mode = "build";
    // Explicit empties as JSON would omit optional maps entirely.
    bridge.timeline = [];
    bridge.toolCalls = {};
    bridge.lastAgentText = "";

    const merged = mergeBridgeSnapshot(client, bridge);

    assert.equal(Object.keys(merged.subagents ?? {}).length, 4);
    assert.equal(Object.keys(merged.subagentLinks ?? {}).length, 4);
    assert.equal(merged.goal?.goalId, "g1");
    assert.equal(merged.backgroundTasks?.bg1?.taskId, "bg1");
    assert.equal(merged.todos?.length, 1);
    assert.equal(merged.tokenUsage?.totalTokens, 30);
    assert.equal(merged.tokenUsage?.contextTokensUsed, undefined);
    assert.equal(merged.timeline.length, 1);
    assert.equal(merged.lastAgentText, "working");
    assert.equal(merged.plan?.length, 1);
    assert.equal(merged.title, "Parent chat");
    assert.ok(merged.toolCalls["call-1"]);
    // Bridge-owned lifecycle always wins.
    assert.equal(merged.status, "streaming");
    assert.equal(merged.model, "grok-4.5");
  });

  it("Node-shaped non-empty bridge merges maps with bridge winning same keys", () => {
    const client = createSessionState({ id: "s", workspace: "/w" });
    client.subagents = {
      a: {
        subagentId: "a",
        childSessionId: "a",
        type: "general-purpose",
        description: "old-a",
        status: "running",
      },
      b: {
        subagentId: "b",
        childSessionId: "b",
        type: "explore",
        description: "only-client",
        status: "running",
      },
      c: {
        subagentId: "c",
        childSessionId: "c",
        type: "plan",
        description: "old-c",
        status: "running",
      },
    };
    client.timeline = [
      { id: "old", kind: "agent", text: "stale" },
    ];

    const bridge = createSessionState({ id: "s", workspace: "/w" });
    bridge.timeline = [
      { id: "new", kind: "agent", text: "fresh from node" },
    ];
    bridge.lastAgentText = "fresh from node";
    bridge.subagents = {
      a: {
        subagentId: "a",
        childSessionId: "a",
        type: "general-purpose",
        description: "new-a",
        status: "completed",
      },
      c: {
        subagentId: "c",
        childSessionId: "c",
        type: "plan",
        description: "new-c",
        status: "completed",
      },
    };

    const merged = mergeBridgeSnapshot(client, bridge);
    // Union of 3; bridge overwrites a and c.
    assert.equal(Object.keys(merged.subagents ?? {}).length, 3);
    assert.equal(merged.subagents?.a?.description, "new-a");
    assert.equal(merged.subagents?.a?.status, "completed");
    assert.equal(merged.subagents?.b?.description, "only-client");
    assert.equal(merged.subagents?.c?.description, "new-c");
    // Non-empty bridge timeline replaces client.
    assert.equal(merged.timeline.length, 1);
    assert.equal(
      (merged.timeline[0] as { text?: string }).text,
      "fresh from node",
    );
  });

  it("bridge-owned status/mode/pendingPermission always come from bridge", () => {
    const client = createSessionState({ id: "s" });
    client.status = "streaming";
    client.mode = "build";
    client.pendingPermission = {
      id: "p1",
      sessionId: "s",
      toolCall: { toolCallId: "t1" },
      options: [],
    } as never;

    const bridge = createSessionState({ id: "s" });
    bridge.status = "idle";
    bridge.mode = "ask";
    bridge.pendingPermission = undefined;

    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.status, "idle");
    assert.equal(merged.mode, "ask");
    assert.equal(merged.pendingPermission, undefined);
  });

  it("empty bridge timeline does not wipe non-empty client timeline", () => {
    const client = createSessionState({ id: "s" });
    client.timeline = [
      {
        id: "u1",
        kind: "user",
        blocks: [{ type: "text", text: "keep" }],
      },
      { id: "a1", kind: "agent", text: "reply" },
    ];
    const bridge = createSessionState({ id: "s" });
    bridge.timeline = [];
    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.timeline.length, 2);
  });

  it("non-empty bridge timeline overwrites client timeline", () => {
    const client = createSessionState({ id: "s" });
    client.timeline = [{ id: "old", kind: "agent", text: "old" }];
    const bridge = createSessionState({ id: "s" });
    bridge.timeline = [{ id: "new", kind: "agent", text: "new" }];
    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.timeline.length, 1);
    assert.equal((merged.timeline[0] as { text?: string }).text, "new");
  });

  it("empty bridge availableCommands does not wipe a client slash catalog", () => {
    const client = createSessionState({ id: "s" });
    client.availableCommands = [
      { name: "compact", description: "Compress conversation history" },
      { name: "context", description: "Show context window usage" },
    ];
    const bridge = createSessionState({ id: "s" });
    bridge.availableCommands = [];
    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.availableCommands?.length, 2);
    assert.equal(merged.availableCommands?.[0]?.name, "compact");
  });

  it("non-empty bridge availableCommands replaces the client slash catalog", () => {
    const client = createSessionState({ id: "s" });
    client.availableCommands = [{ name: "compact", description: "old" }];
    const bridge = createSessionState({ id: "s" });
    bridge.availableCommands = [
      { name: "plugins", description: "Manage plugins" },
    ];
    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.availableCommands?.length, 1);
    assert.equal(merged.availableCommands?.[0]?.name, "plugins");
  });

  it("bridge billed tokenUsage keeps the client's live occupancy", () => {
    const client = createSessionState({ id: "s" });
    client.tokenUsage = {
      inputTokens: 80_000,
      outputTokens: 0,
      totalTokens: 80_000,
      contextTokensUsed: 80_000,
    };
    const bridge = createSessionState({ id: "s" });
    bridge.tokenUsage = {
      inputTokens: 1_200_000,
      outputTokens: 50,
      totalTokens: 1_200_050,
    };
    const merged = mergeBridgeSnapshot(client, bridge);
    assert.equal(merged.tokenUsage?.inputTokens, 1_200_000);
    assert.equal(merged.tokenUsage?.contextTokensUsed, 80_000);
  });
});

describe("mergeAvailableModelsPreferContext (acp-core)", () => {
  it("fills totalContextTokens from secondary when primary lacks them", () => {
    const merged = mergeAvailableModelsPreferContext(
      [{ id: "grok-4.5", name: "Grok" }],
      [{ id: "grok-4.5", name: "Grok", totalContextTokens: 131072 }],
    );
    assert.equal(merged?.[0]?.totalContextTokens, 131072);
  });
});
