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
  extractGoalIntentLine,
  looksLikeHarnessRolePrompt,
  normalizeEchoBody,
  resetTimelineIdCounter,
  sanitizeUserEchoText,
  stripSystemReminders,
  summarizeHarnessRolePrompt,
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

/**
 * Goal-mode injection shape from session 019ff165 (parent plan execution).
 * Entire body is a system-reminder — old strip left the canvas empty.
 */
const GOAL_REMINDER = [
  "<system-reminder>",
  "A goal has been set: @docs/refactor-extensions-environment-2026-08-11.md",
  "",
  "You are working directly on this goal across multiple turns. Deliver",
  "EVERYTHING the user asked for yourself — no follow-up questions.",
  "Plan: /Users/me/.grok/sessions/…/goal/plan.md",
  "</system-reminder>",
].join("\n");

/**
 * Subagent adversarial-verifier pack shape (session 019ff178).
 * Padded past the length gate so the role-card heuristic fires.
 */
const VERIFIER_ROLE_PROMPT = [
  "You are an **adversarial verifier** for the xAI Grok Build harness. You are",
  "NOT the agent that produced the work below. Your job is to **refute** that the",
  "objective has been met. **Default to `refuted: true` if uncertain**.",
  "",
  "## Inputs",
  "",
  "- OBJECTIVE: the user's goal, verbatim.",
  "- PLAN_FILE: path to the Markdown plan, or `(unavailable)`.",
  "- PLAN_CHANGES: a diff of how the agent edited PLAN_FILE, or `(none)`.",
  "- CHANGES_FILE: a unified-diff changelog; may be truncated or `(unavailable)`.",
  "- CHANGED_FILES: the COMPLETE list of files this goal created/modified.",
  "- FINAL_RESPONSE: the agent's own summary.",
  "",
  "## Output contract — STRICT",
  "",
  "Write the JSON verdict then the terminal token.",
  "",
  // Pad so length exceeds the harness role min (ordinary chat stays short).
  "x".repeat(1600),
  "",
  "OBJECTIVE:",
  "@docs/refactor-extensions-environment-2026-08-11.md",
  "",
  "CHANGED_FILES:",
  "- apps/desktop/src/lib/inspectModel.ts",
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
      // Binary image must survive echo absorb — agent only sends [Image #N] text.
      const images = users[0].blocks.filter((b) => b.type === "image");
      assert.equal(images.length, 1);
      if (images[0]?.type === "image") {
        assert.equal(images[0].data, "AAAA");
        assert.equal(images[0].mimeType, "image/webp");
      }
    }
  });

  it("image-only local prompt keeps binary blocks when agent echoes [Image #N]", () => {
    let state = createSessionState({ id: "s-image-only" });
    state = appendUserPrompt(state, [
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo" },
    ]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "[Image #1]" },
    });

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(userTextFromBlocks(users[0].blocks), "");
      assert.equal(users[0].agentConfirmed, true);
      const images = users[0].blocks.filter((b) => b.type === "image");
      assert.equal(images.length, 1);
      if (images[0]?.type === "image") {
        assert.equal(images[0].data, "iVBORw0KGgo");
      }
      // Placeholder must not be written as a second text body on the row.
      assert.equal(
        users[0].blocks.some(
          (b) => b.type === "text" && /\[Image/i.test(b.text),
        ),
        false,
      );
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

  it("goal injection becomes a short Goal intent line (not empty, not full reminder)", () => {
    assert.equal(
      extractGoalIntentLine(GOAL_REMINDER),
      "Goal: @docs/refactor-extensions-environment-2026-08-11.md",
    );
    assert.equal(
      sanitizeUserEchoText(GOAL_REMINDER),
      "Goal: @docs/refactor-extensions-environment-2026-08-11.md",
    );

    let state = createSessionState({ id: "s-goal" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: GOAL_REMINDER },
      _meta: { modelId: "grok-4.5", promptIndex: 0 },
    });
    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      assert.equal(
        userTextFromBlocks(users[0].blocks),
        "Goal: @docs/refactor-extensions-environment-2026-08-11.md",
      );
    }
  });

  it("adversarial verifier role pack collapses to role · objective", () => {
    assert.equal(looksLikeHarnessRolePrompt(VERIFIER_ROLE_PROMPT), true);
    assert.equal(
      summarizeHarnessRolePrompt(VERIFIER_ROLE_PROMPT),
      "adversarial verifier · @docs/refactor-extensions-environment-2026-08-11.md",
    );
    assert.equal(
      sanitizeUserEchoText(VERIFIER_ROLE_PROMPT),
      "adversarial verifier · @docs/refactor-extensions-environment-2026-08-11.md",
    );

    let state = createSessionState({ id: "s-verifier" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: VERIFIER_ROLE_PROMPT },
      _meta: { modelId: "grok-4.5", promptIndex: 0 },
    });
    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      const body = userTextFromBlocks(users[0].blocks);
      assert.equal(
        body,
        "adversarial verifier · @docs/refactor-extensions-environment-2026-08-11.md",
      );
      assert.equal(body.includes("You are an"), false);
      assert.equal(body.includes("Output contract"), false);
    }
  });

  it("ordinary short chat is never collapsed as a harness role pack", () => {
    const chat = "You are right, fix the button padding please";
    assert.equal(looksLikeHarnessRolePrompt(chat), false);
    assert.equal(sanitizeUserEchoText(chat), chat);
  });

  it("seed heal rewrites cached goal dumps and verifier packs", () => {
    const tagged = tagSeedUserMessages([
      {
        kind: "user",
        id: "u-goal",
        blocks: [{ type: "text", text: GOAL_REMINDER }],
      },
      {
        kind: "user",
        id: "u-verifier",
        blocks: [{ type: "text", text: VERIFIER_ROLE_PROMPT }],
      },
      {
        kind: "user",
        id: "u-human",
        blocks: [{ type: "text", text: "real human follow-up" }],
      },
    ]);
    assert.equal(tagged.length, 3);
    assert.deepEqual(
      tagged.map((item) =>
        item.kind === "user" ? userTextFromBlocks(item.blocks) : "",
      ),
      [
        "Goal: @docs/refactor-extensions-environment-2026-08-11.md",
        "adversarial verifier · @docs/refactor-extensions-environment-2026-08-11.md",
        "real human follow-up",
      ],
    );
  });

  it("session/load image chunks attach binary so thumbs survive without optimistic local", () => {
    // Wire order from real grok-build updates.jsonl: text with [Image #N], then
    // a separate content.type === "image" chunk with base64. Old reducer dropped
    // the image chunk (empty text) → only placeholder chips after reload.
    const sent = "你改完为什么图片预览不了 [Image #1] ";
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let state = createSessionState({ id: "s-img-wire" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: sent },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: png },
    });

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      // Placeholder stripped once binary is present.
      assert.equal(
        userTextFromBlocks(users[0].blocks),
        "你改完为什么图片预览不了",
      );
      const images = users[0].blocks.filter((b) => b.type === "image");
      assert.equal(images.length, 1);
      if (images[0]?.type === "image") {
        assert.equal(images[0].data, png);
        assert.equal(images[0].mimeType, "image/png");
      }
    }

    // Replay of the same image chunk must not stack a second thumb.
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: png },
    });
    const users2 = userRows(state);
    assert.ok(users2[0] && users2[0].kind === "user");
    if (users2[0]?.kind === "user") {
      assert.equal(
        users2[0].blocks.filter((b) => b.type === "image").length,
        1,
      );
    }
  });

  it("multi-turn session/load replay attaches each image to its own turn", () => {
    // Real reload shape: agent-origin rows never reach agentConfirmed, so a
    // "first unconfirmed row" target stacked every image of the transcript on
    // turn 1 and left later turns with bare `[Image #N]` chips.
    const png1 = "PNG_TURN_ONE";
    const png2 = "PNG_TURN_TWO";
    let state = createSessionState({ id: "s-img-multi" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "看下这个会话 [Image #1]" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: png1 },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer one" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "你改完为什么图片预览不了 [Image #1]" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: png2 },
    });

    const users = userRows(state);
    assert.equal(users.length, 2);
    const payloads = users.map((row) =>
      row.kind === "user"
        ? row.blocks
            .filter((b) => b.type === "image")
            .map((b) => (b.type === "image" ? b.data : ""))
        : [],
    );
    assert.deepEqual(payloads, [[png1], [png2]]);
    // Both bodies keep their own text with placeholders cleaned.
    assert.deepEqual(
      users.map((row) =>
        row.kind === "user" ? userTextFromBlocks(row.blocks) : "",
      ),
      ["看下这个会话", "你改完为什么图片预览不了"],
    );
  });

  it("a prompt sent after session/load replay absorbs its echo instead of doubling", () => {
    // Replayed rows are agent-origin and never confirm, so a "first unconfirmed
    // row" search stopped at turn 1: the local row kept the typed body while the
    // echo opened a second bubble carrying the raw `[Image #N]` stand-in.
    const png = "LOCAL_PNG_PAYLOAD";
    let state = createSessionState({ id: "s-after-replay" });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "replayed turn one" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "replayed answer one" },
    });

    state = appendUserPrompt(state, [
      { type: "text", text: "新的一条带图消息" },
      { type: "image", mimeType: "image/png", data: png },
    ]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "新的一条带图消息 [Image #1]" },
    });

    const users = userRows(state);
    assert.equal(users.length, 2);
    const live = users[1];
    assert.ok(live && live.kind === "user");
    if (live?.kind === "user") {
      assert.equal(live.origin, "local");
      assert.equal(live.agentConfirmed, true);
      assert.equal(userTextFromBlocks(live.blocks), "新的一条带图消息");
      assert.equal(live.blocks.filter((b) => b.type === "image").length, 1);
    }
  });

  it("image chunk keeps local optimistic binary instead of stacking agent copy", () => {
    const localPng = "LOCAL_BASE64_PAYLOAD";
    const agentPng = "AGENT_COMPRESSED_PAYLOAD";
    let state = createSessionState({ id: "s-img-local" });
    state = appendUserPrompt(state, [
      { type: "text", text: "see this" },
      { type: "image", mimeType: "image/png", data: localPng },
    ]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "see this [Image #1]" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: agentPng },
    });

    const users = userRows(state);
    assert.equal(users.length, 1);
    assert.ok(users[0] && users[0].kind === "user");
    if (users[0]?.kind === "user") {
      const images = users[0].blocks.filter((b) => b.type === "image");
      assert.equal(images.length, 1);
      if (images[0]?.type === "image") {
        assert.equal(images[0].data, localPng);
      }
    }
  });
});
