/**
 * Timeline reducer + tool patch-merge tests against real applySessionUpdate.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  abandonUnconfirmedSeedContent,
  applySessionUpdate,
  applyUserMessageChunk,
  createSessionState,
  extractSessionUpdate,
  patchToolCard,
  resetTimelineIdCounter,
  userImagesFromBlocks,
  userTextFromBlocks,
} from "../src/timeline.js";
import {
  appendUserPrompt,
  buildPermissionOutcome,
  clearPendingPermission,
  markDisconnected,
  markPromptSettled,
  markPromptStarted,
  setPendingPermission,
  shapePermissionRequest,
  tagSeedUserMessages,
  transitionStatus,
} from "../src/sessionLifecycle.js";
import { normalizeAvailableCommands } from "../src/sessionMetadata.js";
import type { TimelineItem } from "../src/types.js";

describe("timeline / tool patch-merge", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("patchToolCard status-only does not wipe content", () => {
    const existing = {
      toolCallId: "t1",
      title: "edit foo.ts",
      kind: "edit",
      status: "pending",
      content: {
        type: "diff",
        path: "foo.ts",
        oldText: "a",
        newText: "b",
      },
    };
    const patched = patchToolCard(existing, {
      toolCallId: "t1",
      status: "completed",
    });
    assert.equal(patched.status, "completed");
    assert.deepEqual(patched.content, existing.content);
    assert.equal(patched.title, "edit foo.ts");
  });

  it("applySessionUpdate tool_call then status-only tool_call_update preserves content", () => {
    let state = createSessionState({ id: "s1", workspace: "/tmp/proj" });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "read main.ts",
      kind: "read",
      status: "pending",
      content: { body: "file contents here" },
    });
    assert.equal(state.timeline.some((t) => t.kind === "tool"), true);
    assert.deepEqual(state.toolCalls["tc-1"]?.content, {
      body: "file contents here",
    });

    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
    });
    assert.equal(state.toolCalls["tc-1"]?.status, "completed");
    assert.deepEqual(state.toolCalls["tc-1"]?.content, {
      body: "file contents here",
    });
    // still one timeline pointer
    assert.equal(
      state.timeline.filter((t) => t.kind === "tool").length,
      1,
    );
  });

  it("agent_message_chunk streams into one agent item and lastAgentText", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "world" },
    });
    assert.equal(state.timeline.length, 1);
    assert.equal(state.timeline[0]?.kind, "agent");
    if (state.timeline[0]?.kind === "agent") {
      assert.equal(state.timeline[0].text, "Hello world");
    }
    assert.equal(state.lastAgentText, "Hello world");
    assert.equal(state.status, "streaming");
  });

  it("thought chunks merge into collapsed thought item", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "think " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "more" },
    });
    assert.equal(state.timeline[0]?.kind, "thought");
    if (state.timeline[0]?.kind === "thought") {
      assert.equal(state.timeline[0].text, "think more");
      assert.equal(state.timeline[0].collapsed, true);
    }
  });

  it("completes Thinking when the agent starts its visible answer", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "plan response" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });

    const thought = state.timeline[0];
    assert.equal(thought?.kind, "thought");
    if (thought?.kind === "thought") {
      assert.equal(typeof thought.startedAt, "number");
      assert.equal(typeof thought.completedAt, "number");
    }

    state = markPromptSettled(state);
    assert.equal(state.status, "idle");
  });

  it("plan replaces entire plan list", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [{ content: "A", status: "pending" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [
        { content: "A", status: "completed" },
        { content: "B", status: "in_progress" },
      ],
    });
    assert.equal(state.plan?.length, 2);
    assert.equal(state.plan?.[1]?.content, "B");
  });

  it("extractSessionUpdate reads nested update field", () => {
    const u = extractSessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { text: "x" },
      },
    });
    assert.equal(u?.sessionUpdate, "agent_message_chunk");
  });

  it("permission shaping defaults four options and buildPermissionOutcome", () => {
    const req = shapePermissionRequest(9, {
      toolCall: { toolCallId: "t", title: "run ls", kind: "execute" },
    });
    assert.equal(req.requestId, 9);
    assert.equal(req.options?.length, 4);
    assert.equal(req.toolCall?.title, "run ls");
    const outcome = buildPermissionOutcome("allow_once");
    assert.deepEqual(outcome, {
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  it("status transitions: streaming → waiting_permission → streaming → idle path", () => {
    let state = createSessionState({ id: "s1" });
    state = markPromptStarted(state);
    assert.equal(state.status, "streaming");
    state = setPendingPermission(state, shapePermissionRequest(1, {}));
    assert.equal(state.status, "waiting_permission");
    state = clearPendingPermission(state, "streaming");
    assert.equal(state.status, "streaming");
    assert.equal(state.pendingPermission, undefined);
    state = markDisconnected(state);
    assert.equal(state.status, "disconnected");
  });

  it("appendUserPrompt adds user blocks and sets streaming", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [{ type: "text", text: "hi" }]);
    assert.equal(state.timeline[0]?.kind, "user");
    assert.equal(state.status, "streaming");
  });

  it("userImagesFromBlocks keeps image payloads for timeline preview", () => {
    const blocks = [
      { type: "text" as const, text: "see this" },
      { type: "image" as const, mimeType: "image/png", data: "abc123" },
      { type: "resource_link" as const, uri: "file:///x" },
    ];
    assert.equal(userTextFromBlocks(blocks), "see this");
    assert.deepEqual(userImagesFromBlocks(blocks), [
      { mimeType: "image/png", data: "abc123" },
    ]);
  });

  it("user_message_chunk does not duplicate optimistic appendUserPrompt text", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [
      { type: "text", text: "Introduce demo in one sentence" },
    ]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Introduce demo in one sentence" },
    });
    const user = state.timeline.find((item) => item.kind === "user");
    assert.ok(user && user.kind === "user");
    if (user && user.kind === "user") {
      const text = user.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      assert.equal(text, "Introduce demo in one sentence");
      assert.notEqual(
        text,
        "Introduce demo in one sentenceIntroduce demo in one sentence",
      );
    }
  });

  it("user_message_chunk can extend a shorter optimistic prefix", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [{ type: "text", text: "hello" }]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hello world" },
    });
    const user = state.timeline.find((item) => item.kind === "user");
    assert.ok(user && user.kind === "user");
    if (user && user.kind === "user") {
      const text = user.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      assert.equal(text, "hello world");
    }
  });

  it("tagSeedUserMessages collapses repeated bodies from pre-fix catalog cache", () => {
    const once = "In one sentence, describe what the demo workspace is for. Do not change any files.";
    // Odd counts too: the pre-fix bug added one copy per replay, not per pair.
    const doubled = once + once + once;
    const tagged = tagSeedUserMessages([
      {
        kind: "user",
        id: "user-corrupt",
        blocks: [{ type: "text", text: doubled }],
      },
      { kind: "agent", id: "a1", text: "ok" },
      {
        kind: "user",
        id: "user-ok",
        blocks: [{ type: "text", text: once }],
      },
    ]);
    assert.ok(tagged[0] && tagged[0].kind === "user");
    assert.ok(tagged[2] && tagged[2].kind === "user");
    if (tagged[0]?.kind === "user" && tagged[2]?.kind === "user") {
      assert.equal(userTextFromBlocks(tagged[0].blocks), once);
      assert.equal(userTextFromBlocks(tagged[2].blocks), once);
      assert.notEqual(userTextFromBlocks(tagged[0].blocks), doubled);
    }
    // Replay of original single copy must not re-double after normalize.
    let state = createSessionState({ id: "resume-corrupt" });
    state = { ...state, timeline: tagged };
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: once },
    });
    const users = state.timeline.filter((i) => i.kind === "user");
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), once);
    }
  });

  it("multi-turn seed + user_message_chunk replay leaves user text byte-identical", () => {
    const u1 =
      "In one sentence, describe what the demo workspace is for. Do not change any files.";
    const u2 =
      "@src/hello.ts  Read this file only and quote one line of code from it. Do not modify the file.";
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "user",
        id: "user-1",
        blocks: [{ type: "text", text: u1 }],
      },
      { kind: "agent", id: "agent-1", text: "Demo is a sample workspace." },
      {
        kind: "user",
        id: "user-2",
        blocks: [{ type: "text", text: u2 }],
      },
      { kind: "agent", id: "agent-2", text: "const x = 1;" },
    ]);
    let state = createSessionState({ id: "resume-1" });
    state = { ...state, timeline: seeded };

    // Agent session/load replays both user messages (last item is agent — old bug path).
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: u1 },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Demo is a sample workspace." },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: u2 },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "const x = 1;" },
    });

    const users = state.timeline.filter((item) => item.kind === "user");
    assert.equal(users.length, 2);
    assert.ok(users[0] && users[0].kind === "user");
    assert.ok(users[1] && users[1].kind === "user");
    if (users[0]?.kind === "user" && users[1]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), u1);
      assert.equal(userTextFromBlocks(users[1].blocks), u2);
      assert.equal(users[0].agentConfirmed, true);
      assert.equal(users[1].agentConfirmed, true);
    }
  });

  it("chunked user_message_chunk replay of one message leaves text unchanged", () => {
    const full = "Introduce demo in one sentence. Do not edit files.";
    let state = createSessionState({ id: "s-chunk" });
    state = appendUserPrompt(state, [{ type: "text", text: full }]);

    // Split full sentence into progressive prefix-style chunks and true fragments.
    const parts = [
      "Introduce ",
      "demo in one ",
      "sentence. Do not edit files.",
    ];
    let acc = "";
    for (const part of parts) {
      acc += part;
      state = applySessionUpdate(state, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: part },
      });
    }
    // Extra full-text echo after chunks must not double.
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: full },
    });

    const users = state.timeline.filter((item) => item.kind === "user");
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), full);
      assert.notEqual(
        userTextFromBlocks(users[0].blocks),
        full + full,
      );
    }
    assert.equal(acc, full);
  });

  it("applyUserMessageChunk does not produce ABA when prefix chunk follows full local text", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "AB" }],
        origin: "local",
        clientPromptId: "prompt-1",
        agentConfirmed: false,
      },
    ];
    // Old string heuristic: prev.endsWith("A") false, "A".startsWith("AB") false → "ABA".
    const next = applyUserMessageChunk(timeline, "A");
    assert.equal(next.length, 1);
    assert.ok(next[0] && next[0].kind === "user");
    if (next[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(next[0].blocks), "AB");
    }
  });

  it("transitionStatus returns next status", () => {
    assert.equal(transitionStatus("idle", "streaming"), "streaming");
    assert.equal(
      transitionStatus("streaming", "waiting_permission"),
      "waiting_permission",
    );
  });

  it("session_info_update sets title without timeline error row", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "  Fix login bug  ",
    });
    assert.equal(state.title, "Fix login bug");
    assert.equal(state.timeline.length, 0);

    // Partial update without title field leaves title alone
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      updatedAt: "2026-08-07T00:00:00Z",
    });
    assert.equal(state.title, "Fix login bug");
    assert.equal(state.updatedAt, "2026-08-07T00:00:00Z");

    // null clears title
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: null,
    });
    assert.equal(state.title, undefined);
  });

  it("current_mode_update maps aliases onto product modes", () => {
    let state = createSessionState({ id: "s", mode: "ask" });
    state = applySessionUpdate(state, {
      sessionUpdate: "current_mode_update",
      currentModeId: "acceptEdits",
    });
    assert.equal(state.mode, "build");
    state = applySessionUpdate(state, {
      sessionUpdate: "current_mode_update",
      mode: "plan",
    });
    assert.equal(state.mode, "plan");
  });

  it("todos_update stores todos without timeline noise", () => {
    const state = applySessionUpdate(createSessionState({ id: "s" }), {
      sessionUpdate: "todos_update",
      todos: [{ content: "A", status: "pending" }],
    });
    assert.ok(state.todos && state.todos.length === 1);
    assert.equal(state.timeline.length, 0);
  });

  it("config_option_update stores options without timeline noise", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [{ id: "model", currentValue: "grok" }],
    });
    assert.equal(state.configOptions?.length, 1);
    assert.equal(state.timeline.length, 0);
  });

  it("normalizes real command metadata before it reaches the composer", () => {
    const commands = normalizeAvailableCommands([
      {
        name: "review",
        description: "Run a review",
        input: { hint: "[--local]" },
        _meta: { scope: "bundled" },
      },
      { name: "review", description: "duplicate" },
      { name: 42 },
    ]);

    assert.deepEqual(commands, [
      {
        name: "review",
        description: "Run a review",
        input: { hint: "[--local]" },
        _meta: { scope: "bundled" },
      },
    ]);
  });

  it("available_commands_update replaces the slash catalog", () => {
    let state = createSessionState({ id: "s" });
    state = applySessionUpdate(state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Compress history" },
        { name: "context", description: "Usage stats", input: null },
      ],
    });
    assert.equal(state.availableCommands?.length, 2);
    assert.equal(state.availableCommands?.[0]?.name, "compact");
    state = applySessionUpdate(state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "plugins", description: "Manage plugins" }],
    });
    assert.equal(state.availableCommands?.length, 1);
    assert.equal(state.availableCommands?.[0]?.name, "plugins");
  });

  it("silent plan/todos/mode/session_info/token updates do not split continuous thought", () => {
    let state = createSessionState({ id: "s-silent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "partA " },
    });
    // Each of these draws nothing on the timeline — must not finalize.
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [{ content: "step", status: "pending" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "todos_update",
      todos: [{ content: "todo", status: "pending" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "current_mode_update",
      currentModeId: "acceptEdits",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "Working",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [{ id: "model", currentValue: "grok" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "token_usage" as "agent_message_chunk",
      content: { type: "text", text: "ignored" },
    });
    // Soft-ignore path uses kind string only; force a usage-like unknown kind:
    state = applySessionUpdate(state, {
      sessionUpdate: "usage_update" as "plan",
    } as Parameters<typeof applySessionUpdate>[1]);

    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "partB" },
    });

    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    assert.equal(thoughts.length, 1);
    assert.ok(thoughts[0] && thoughts[0].kind === "thought");
    if (thoughts[0]?.kind === "thought") {
      assert.equal(thoughts[0].text, "partA partB");
      assert.equal(thoughts[0].completedAt, undefined);
    }
    assert.equal(state.plan?.length, 1);
    assert.equal(state.todos?.length, 1);
    assert.equal(state.mode, "build");
    assert.equal(state.title, "Working");
  });

  it("tool_call between thoughts yields two thought rows with tool between", () => {
    let state = createSessionState({ id: "s-tool-split" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "before tool" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-split",
      title: "read x",
      kind: "read",
      status: "pending",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "after tool" },
    });

    const kinds = state.timeline.map((t) => t.kind);
    assert.deepEqual(kinds, ["thought", "tool", "thought"]);
    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    assert.equal(thoughts.length, 2);
    if (thoughts[0]?.kind === "thought" && thoughts[1]?.kind === "thought") {
      assert.equal(thoughts[0].text, "before tool");
      assert.equal(typeof thoughts[0].completedAt, "number");
      assert.equal(thoughts[1].text, "after tool");
      assert.equal(thoughts[1].completedAt, undefined);
    }
  });

  it("unknown kind that becomes an error row finalizes open thought", () => {
    let state = createSessionState({ id: "s-err" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "totally_unknown_kind" as "plan",
    } as Parameters<typeof applySessionUpdate>[1]);

    assert.equal(state.timeline.length, 2);
    assert.equal(state.timeline[0]?.kind, "thought");
    assert.equal(state.timeline[1]?.kind, "error");
    if (state.timeline[0]?.kind === "thought") {
      assert.equal(typeof state.timeline[0].completedAt, "number");
    }
  });

  it("seed + session/load replay does not duplicate agent or thought rows", () => {
    const agentBody =
      "demo 是一个受限的本地演练场，用来安全地试验 agent 能力。";
    const thoughtBody = "User wants a short Chinese demo description.";
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "user",
        id: "user-1",
        blocks: [
          {
            type: "text",
            text: "Introduce demo in one sentence. Do not edit files.",
          },
        ],
      },
      {
        kind: "thought",
        id: "thought-1",
        text: thoughtBody,
        collapsed: true,
        startedAt: 1_000,
        completedAt: 2_000,
      },
      {
        kind: "agent",
        id: "agent-1",
        text: agentBody,
      },
    ]);

    let state = createSessionState({ id: "resume-agent" });
    state = { ...state, timeline: seeded };

    // Identity tags must mark agent/thought as seed.
    assert.ok(seeded[1] && seeded[1].kind === "thought");
    assert.ok(seeded[2] && seeded[2].kind === "agent");
    if (seeded[1]?.kind === "thought" && seeded[2]?.kind === "agent") {
      assert.equal(seeded[1].origin, "seed");
      assert.equal(seeded[1].agentConfirmed, false);
      assert.equal(seeded[2].origin, "seed");
      assert.equal(seeded[2].agentConfirmed, false);
    }

    // Replay full transcript the way session/load does.
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: {
        type: "text",
        text: "Introduce demo in one sentence. Do not edit files.",
      },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: thoughtBody },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: agentBody },
    });

    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    const agents = state.timeline.filter((t) => t.kind === "agent");
    const users = state.timeline.filter((t) => t.kind === "user");
    assert.equal(users.length, 1);
    assert.equal(thoughts.length, 1, "thought must not double-append on replay");
    assert.equal(agents.length, 1, "agent must not double-append on replay");
    assert.equal(state.timeline.length, 3);

    if (thoughts[0]?.kind === "thought") {
      assert.equal(thoughts[0].text, thoughtBody);
      assert.equal(thoughts[0].agentConfirmed, true);
    }
    if (agents[0]?.kind === "agent") {
      assert.equal(agents[0].text, agentBody);
      assert.equal(agents[0].agentConfirmed, true);
    }
  });

  it("chunked seed replay claims one agent and one thought without doubling", () => {
    const agentFull = "Hello world from agent.";
    const thoughtFull = "plan then answer";
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "user",
        id: "u",
        blocks: [{ type: "text", text: "hi" }],
      },
      {
        kind: "thought",
        id: "th",
        text: thoughtFull,
        collapsed: true,
        startedAt: 10,
        completedAt: 20,
      },
      { kind: "agent", id: "ag", text: agentFull },
    ]);
    let state = createSessionState({ id: "chunk-replay" });
    state = { ...state, timeline: seeded };

    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hi" },
    });
    for (const part of ["plan ", "then ", "answer"]) {
      state = applySessionUpdate(state, {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: part },
      });
    }
    for (const part of ["Hello ", "world ", "from agent."]) {
      state = applySessionUpdate(state, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: part },
      });
    }

    assert.equal(state.timeline.filter((t) => t.kind === "thought").length, 1);
    assert.equal(state.timeline.filter((t) => t.kind === "agent").length, 1);
    const thought = state.timeline.find((t) => t.kind === "thought");
    const agent = state.timeline.find((t) => t.kind === "agent");
    assert.ok(thought && thought.kind === "thought");
    assert.ok(agent && agent.kind === "agent");
    if (thought?.kind === "thought" && agent?.kind === "agent") {
      assert.equal(thought.text, thoughtFull);
      assert.equal(agent.text, agentFull);
      assert.equal(thought.agentConfirmed, true);
      assert.equal(agent.agentConfirmed, true);
    }
  });

  it("multi-turn seed + full replay leaves agent texts single-copy", () => {
    const a1 = "Demo is a sample workspace.";
    const a2 = "const x = 1;";
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "user",
        id: "user-1",
        blocks: [{ type: "text", text: "describe demo" }],
      },
      { kind: "agent", id: "agent-1", text: a1 },
      {
        kind: "user",
        id: "user-2",
        blocks: [{ type: "text", text: "quote a line" }],
      },
      { kind: "agent", id: "agent-2", text: a2 },
    ]);
    let state = createSessionState({ id: "multi-agent" });
    state = { ...state, timeline: seeded };

    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "describe demo" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: a1 },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "quote a line" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: a2 },
    });

    const agents = state.timeline.filter((t) => t.kind === "agent");
    assert.equal(agents.length, 2);
    assert.equal(state.timeline.length, 4);
    if (agents[0]?.kind === "agent" && agents[1]?.kind === "agent") {
      assert.equal(agents[0].text, a1);
      assert.equal(agents[1].text, a2);
      assert.notEqual(agents[0].text, a1 + a1);
      assert.notEqual(agents[1].text, a2 + a2);
    }
  });

  it("unconfirmed seed thought + non-matching chunk abandons seed and appends live thought", () => {
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "thought",
        id: "th-seed",
        text: "cached reasoning that will not be replayed",
        collapsed: true,
        startedAt: 1,
        completedAt: 2,
      },
    ]);
    let state = createSessionState({ id: "thought-mismatch" });
    state = { ...state, timeline: seeded };

    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "brand new live reasoning" },
    });

    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    assert.equal(thoughts.length, 2, "seed kept + live thought appended");
    assert.ok(thoughts[0] && thoughts[0].kind === "thought");
    assert.ok(thoughts[1] && thoughts[1].kind === "thought");
    if (thoughts[0]?.kind === "thought" && thoughts[1]?.kind === "thought") {
      assert.equal(thoughts[0].text, "cached reasoning that will not be replayed");
      assert.equal(thoughts[0].agentConfirmed, true, "seed slot abandoned");
      assert.equal(thoughts[1].text, "brand new live reasoning");
      assert.equal(thoughts[1].origin, "agent");
      assert.equal(thoughts[1].completedAt, undefined);
    }
  });

  it("unconfirmed seed agent + non-matching chunk abandons seed and appends live agent", () => {
    const seeded: TimelineItem[] = tagSeedUserMessages([
      { kind: "agent", id: "ag-seed", text: "old cached agent body" },
    ]);
    let state = createSessionState({ id: "agent-mismatch" });
    state = { ...state, timeline: seeded };

    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "fresh answer for a new turn" },
    });

    const agents = state.timeline.filter((t) => t.kind === "agent");
    assert.equal(agents.length, 2, "seed kept + live agent appended");
    assert.ok(agents[0] && agents[0].kind === "agent");
    assert.ok(agents[1] && agents[1].kind === "agent");
    if (agents[0]?.kind === "agent" && agents[1]?.kind === "agent") {
      assert.equal(agents[0].text, "old cached agent body");
      assert.equal(agents[0].agentConfirmed, true);
      assert.equal(agents[1].text, "fresh answer for a new turn");
      assert.equal(agents[1].origin, "agent");
    }
  });

  it("load without thought replay still allows later live thoughts", () => {
    // Seed has thought + agent; session/load only replaying agent (no thought chunks).
    const agentBody = "answer without replaying thought";
    const seeded: TimelineItem[] = tagSeedUserMessages([
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hi" }],
      },
      {
        kind: "thought",
        id: "th-seed",
        text: "seed thought never echoed by load",
        collapsed: true,
        startedAt: 10,
        completedAt: 20,
      },
      { kind: "agent", id: "ag-seed", text: agentBody },
    ]);
    let state = createSessionState({ id: "partial-load" });
    state = { ...state, timeline: seeded };

    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hi" },
    });
    // Agent replay matches seed agent; thought stays unconfirmed.
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: agentBody },
    });
    assert.equal(state.timeline.filter((t) => t.kind === "agent").length, 1);
    const seedThought = state.timeline.find((t) => t.kind === "thought");
    assert.ok(seedThought && seedThought.kind === "thought");
    if (seedThought?.kind === "thought") {
      assert.equal(seedThought.agentConfirmed, false);
    }

    // Later turn: user sends, agent thinks — must not silent-drop into seed thought.
    state = appendUserPrompt(state, [{ type: "text", text: "second question" }]);
    // appendUserPrompt abandons leftover seed thought.
    const afterPrompt = state.timeline.find((t) => t.id === "th-seed");
    assert.ok(afterPrompt && afterPrompt.kind === "thought");
    if (afterPrompt?.kind === "thought") {
      assert.equal(afterPrompt.agentConfirmed, true);
    }

    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking about second question" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "second answer" },
    });

    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    const agents = state.timeline.filter((t) => t.kind === "agent");
    assert.equal(thoughts.length, 2);
    assert.equal(agents.length, 2);
    const liveThought = thoughts[thoughts.length - 1];
    const liveAgent = agents[agents.length - 1];
    assert.ok(liveThought && liveThought.kind === "thought");
    assert.ok(liveAgent && liveAgent.kind === "agent");
    if (liveThought?.kind === "thought" && liveAgent?.kind === "agent") {
      assert.equal(liveThought.text, "thinking about second question");
      assert.equal(liveAgent.text, "second answer");
    }
  });

  it("abandonUnconfirmedSeedContent flips claim latches without rewriting bodies", () => {
    const seeded = tagSeedUserMessages([
      {
        kind: "thought",
        id: "t",
        text: "keep me",
        collapsed: true,
        startedAt: 1,
        completedAt: 2,
      },
      { kind: "agent", id: "a", text: "keep me too" },
    ]);
    const next = abandonUnconfirmedSeedContent(seeded);
    assert.ok(next[0] && next[0].kind === "thought");
    assert.ok(next[1] && next[1].kind === "agent");
    if (next[0]?.kind === "thought" && next[1]?.kind === "agent") {
      assert.equal(next[0].text, "keep me");
      assert.equal(next[1].text, "keep me too");
      assert.equal(next[0].agentConfirmed, true);
      assert.equal(next[1].agentConfirmed, true);
    }
    // Idempotent when already abandoned.
    assert.equal(abandonUnconfirmedSeedContent(next), next);
  });

  it("markPromptStarted abandons leftover seed agent/thought so streaming can proceed", () => {
    const seeded = tagSeedUserMessages([
      { kind: "agent", id: "a", text: "stale seed" },
    ]);
    let state = createSessionState({ id: "start" });
    state = { ...state, timeline: seeded };
    state = markPromptStarted(state);
    assert.ok(state.timeline[0] && state.timeline[0].kind === "agent");
    if (state.timeline[0]?.kind === "agent") {
      assert.equal(state.timeline[0].agentConfirmed, true);
      assert.equal(state.timeline[0].text, "stale seed");
    }
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "live stream" },
    });
    assert.equal(state.timeline.filter((t) => t.kind === "agent").length, 2);
  });
});
