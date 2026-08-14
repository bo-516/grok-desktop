/**
 * Session title helpers: skip Goal-file injections, drop status words,
 * and keep a short id for chrome that must tell sessions apart.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem } from "../src/types.js";
import { createSessionState } from "../src/timeline.js";
import {
  cleanHarnessGoalTitle,
  displaySessionTitle,
  extractTitleFromTimeline,
  isHarnessGoalTitle,
  isWeakSessionTitle,
  pickSessionTitle,
  shortSessionId,
  titleFromSessionState,
} from "../src/sessionTitle.js";

/**
 * One user timeline row with a single text block.
 * @param id Row id.
 * @param text Bubble body (may be a Goal injection).
 */
function user(id: string, text: string): TimelineItem {
  return { kind: "user", id, blocks: [{ type: "text", text }] };
}

describe("isHarnessGoalTitle / cleanHarnessGoalTitle", () => {
  it("detects Goal file mentions and leaves ordinary Goal text alone", () => {
    assert.equal(
      isHarnessGoalTitle(
        "Goal: @refactor-subagent-session-provenance-2026-08-12.md",
      ),
      true,
    );
    assert.equal(
      isHarnessGoalTitle("Goal: @docs/refactor-extensions-environment-2026-08-11.md"),
      true,
    );
    assert.equal(isHarnessGoalTitle("Goal: plan.md"), true);
    assert.equal(isHarnessGoalTitle("Goal: ship the login form"), false);
    assert.equal(isHarnessGoalTitle("Fix the average function"), false);
  });

  it("cleans a Goal file to its stem and ignores non-goal text", () => {
    assert.equal(
      cleanHarnessGoalTitle(
        "Goal: @refactor-subagent-session-provenance-2026-08-12.md",
      ),
      "refactor-subagent-session-provenance-2026-08-12",
    );
    assert.equal(
      cleanHarnessGoalTitle("Goal: @docs/foo.md"),
      "foo",
    );
    assert.equal(cleanHarnessGoalTitle("Goal: ship the login form"), "");
  });
});

describe("isWeakSessionTitle", () => {
  it("treats Goal files and mid-turn status words as weak", () => {
    assert.equal(
      isWeakSessionTitle(
        "Goal: @refactor-subagent-session-provenance-2026-08-12.md",
      ),
      true,
    );
    assert.equal(isWeakSessionTitle("Working"), true);
    assert.equal(isWeakSessionTitle("Working…"), true);
    assert.equal(isWeakSessionTitle("Thinking"), true);
    assert.equal(isWeakSessionTitle("Goal: ship the login form"), false);
  });
});

describe("extractTitleFromTimeline", () => {
  it("skips a Goal injection and uses the next human prompt", () => {
    const title = extractTitleFromTimeline([
      user("u0", "Goal: @refactor-subagent-session-provenance-2026-08-12.md"),
      user(
        "u1",
        "2 创建4个subagent 冒充2组情侣来(10-20句对话)对话 一组青涩 一组老油条",
      ),
    ]);
    assert.match(title, /创建4个subagent/);
    assert.doesNotMatch(title, /^Goal:/);
  });

  it("falls back to the Goal file stem when that is the only user text", () => {
    assert.equal(
      extractTitleFromTimeline([
        user("u0", "Goal: @refactor-subagent-session-provenance-2026-08-12.md"),
      ]),
      "refactor-subagent-session-provenance-2026-08-12",
    );
  });
});

describe("titleFromSessionState / pickSessionTitle", () => {
  it("ignores agent title Working and reads the later user prompt", () => {
    const state = createSessionState({ id: "s1" });
    state.title = "Working";
    state.timeline = [
      user("u0", "Goal: @refactor-subagent-session-provenance-2026-08-12.md"),
      user("u1", "创建4个subagent 冒充2组情侣"),
    ];
    assert.equal(titleFromSessionState(state), "创建4个subagent 冒充2组情侣");
    assert.equal(
      pickSessionTitle({
        state,
        existingTitle:
          "Goal: @refactor-subagent-session-provenance-2026-08-12.md",
      }),
      "创建4个subagent 冒充2组情侣",
    );
  });

  it("keeps a real agent-generated title", () => {
    const state = createSessionState({ id: "s2" });
    state.title = "两对情侣对话：青涩与老油条";
    state.timeline = [
      user("u0", "Goal: @refactor-subagent-session-provenance-2026-08-12.md"),
    ];
    assert.equal(titleFromSessionState(state), "两对情侣对话：青涩与老油条");
  });

  it("pickSessionTitle keeps a user-locked title over a later agent title", () => {
    const state = createSessionState({ id: "s-locked" });
    state.title = "Agent renamed this";
    state.timeline = [user("u1", "original prompt that would become the title")];
    assert.equal(
      pickSessionTitle({
        state,
        existingTitle: "My custom name",
        titleLocked: true,
      }),
      "My custom name",
    );
    assert.equal(
      pickSessionTitle({
        state,
        existingTitle: "My custom name",
        titleLocked: false,
      }),
      "Agent renamed this",
    );
  });
});

describe("displaySessionTitle / shortSessionId", () => {
  it("rewrites a Goal file to its stem instead of Untitled chat", () => {
    assert.equal(
      displaySessionTitle(
        "Goal: @refactor-subagent-session-provenance-2026-08-12.md",
      ),
      "refactor-subagent-session-provenance-2026-08-12",
    );
    assert.equal(displaySessionTitle("Chat 019fd68e"), "Untitled chat");
    assert.equal(displaySessionTitle("Fix login"), "Fix login");
  });

  it("shortens a session id to eight characters", () => {
    assert.equal(
      shortSessionId("019ff63e-1d15-7be0-8021-f4811cfead4f"),
      "019ff63e",
    );
    assert.equal(shortSessionId(""), "");
    assert.equal(shortSessionId(undefined), "");
  });
});
