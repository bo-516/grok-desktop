/**
 * Agent user-echo sanitizing, exercised through the real reducer.
 *
 * Payloads are copied from a recorded grok-build `updates.jsonl` so the shapes
 * here are the ones that actually reached the canvas — a harness reminder
 * chunk, and a prompt echo where an attached image came back as `[Image #N]`.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  extractSessionUpdate,
  normalizeEchoBody,
  resetTimelineIdCounter,
  stripSystemReminders,
  userTextFromBlocks,
} from "../src/timeline.js";
import {
  appendUserPrompt,
  tagSeedUserMessages,
} from "../src/sessionLifecycle.js";
import type { SessionState } from "../src/types.js";

/** Real background-task notice grok-build injects as a user chunk. */
const REMINDER = [
  "<system-reminder>",
  'Background task "call-8dd0cb34" completed (exit code: 0).',
  "Command: ls -la /Users/me/idea/grok-desktop/ 2>/dev/null | head -5",
  'Use get_command_or_subagent_output("call-8dd0cb34") to see the full output.',
  "</system-reminder>",
].join("\n");

/** User rows of a session, narrowed for assertions. */
function userRows(state: SessionState) {
  return state.timeline.filter((item) => item.kind === "user");
}

describe("agent user-echo sanitizing", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("drops the scrollback-hidden reminder chunk grok-build injects", () => {
    let state = createSessionState({ id: "s-reminder" });
    state = appendUserPrompt(state, [{ type: "text", text: "run the build" }]);

    const update = extractSessionUpdate({
      sessionId: "s-reminder",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: REMINDER },
        _meta: { modelId: "grok-4.5", promptIndex: 1, hideFromScrollback: true },
      },
    });
    assert.ok(update);
    state = applySessionUpdate(state, update);

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), "run the build");
    }
  });

  it("drops a reminder chunk even when the hide flag is missing", () => {
    let state = createSessionState({ id: "s-unflagged" });
    state = appendUserPrompt(state, [{ type: "text", text: "run the build" }]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: REMINDER },
    });

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), "run the build");
    }
  });

  it("confirms the local row when the echo adds an [Image #N] placeholder", () => {
    const sent = "/browser-use 弄完测一下  这里UI 是不是有点问题";
    const echoed = "/browser-use 弄完测一下 [Image #1]  这里UI 是不是有点问题";
    let state = createSessionState({ id: "s-image" });
    state = appendUserPrompt(state, [
      { type: "text", text: sent },
      { type: "image", mimeType: "image/webp", data: "AAAA" },
    ]);

    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: echoed },
    });
    // Session/load replay of the same turn must not open a second bubble.
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: echoed },
    });

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), sent);
      assert.equal(users[0].agentConfirmed, true);
    }
  });

  it("reminder chunks cannot pile into a confirmed row", () => {
    const sent = "check the UI";
    let state = createSessionState({ id: "s-pile" });
    state = appendUserPrompt(state, [{ type: "text", text: sent }]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: sent },
    });
    for (const _ of [0, 1, 2]) {
      state = applySessionUpdate(state, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: REMINDER },
        _meta: { hideFromScrollback: true },
      });
    }

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), sent);
    }
  });

  it("heals cached rows that already swallowed reminder text", () => {
    const tagged = tagSeedUserMessages([
      {
        kind: "user",
        id: "u-dirty",
        blocks: [{ type: "text", text: `check the UI${REMINDER}${REMINDER}` }],
      },
      {
        kind: "user",
        id: "u-only-reminder",
        blocks: [{ type: "text", text: REMINDER }],
      },
    ]);

    // The reminder-only row is dropped; the mixed row keeps just the prompt.
    assert.equal(tagged.length, 1);
    assert.ok(tagged[0] && tagged[0].kind === "user");
    if (tagged[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(tagged[0].blocks), "check the UI");
    }
  });

  it("replaying a turn into an uncached session does not stack copies", () => {
    // No catalog cache → nothing to seed, so the replayed echo builds an
    // agent-origin row. Reconnect / reopen replays the same turn again.
    const sent = "/browser-use 弄完测一下 [Image #1]  这里UI 是不是有点问题";
    let state = createSessionState({ id: "s-replay" });
    for (const _ of [0, 1, 2]) {
      state = applySessionUpdate(state, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: sent },
      });
    }

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), sent);
    }
  });

  it("a later turn opens its own bubble instead of joining the previous one", () => {
    let state = createSessionState({ id: "s-turns" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "first question" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "an answer" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "second question" },
    });

    const users = userRows(state);
    assert.equal(users.length, 2);
    assert.deepEqual(
      users.map((u) => (u.kind === "user" ? userTextFromBlocks(u.blocks) : "")),
      ["first question", "second question"],
    );
  });

  it("strips split reminders and normalizes only for comparison", () => {
    assert.equal(stripSystemReminders("keep<system-reminder>drop"), "keep");
    assert.equal(
      stripSystemReminders("drop</system-reminder>\n\n\nkeep"),
      "keep",
    );
    assert.equal(stripSystemReminders("no tags here"), "no tags here");
    assert.equal(
      normalizeEchoBody("look [Image #2]  at   this"),
      "look at this",
    );
  });
});
