/**
 * Background mode switch: chip updates immediately, prompt waits for
 * `mode set to <id>`, failure reverts and does not send.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import { clearPendingModeTimer } from "@/store/pendingMode";
import {
  beginModeSwitch,
  cancelTurnAction,
  deferPromptForPendingMode,
  failModeSwitch,
  modeFromReadyInfo,
  noteModeReadyInfo,
  noteModeRestartRequired,
} from "@/store/sessionStoreModeHold";
import {
  pinModeHoldOnCanvas,
  type HeldPrompt,
  type ModeHoldState,
} from "@/store/sessionStoreModeHoldCanvas";

afterEach(() => {
  clearPendingModeTimer();
});

type Calls = {
  setMode: string[];
  prompt: string[];
  cancel: number;
};

/**
 * Minimal mode-hold slice with a spy bridge.
 * @param mode Painted mode.
 * @param id Session id. Empty means a New chat draft.
 */
function makeState(mode: SessionState["mode"], id = "sess-1"): {
  state: ModeHoldState;
  calls: Calls;
} {
  const calls: Calls = { setMode: [], prompt: [], cancel: 0 };
  const session = createSessionState({ id, workspace: "/w", mode });
  const state: ModeHoldState = {
    session,
    connectionMode: "live-bridge",
    live: {
      setMode: (modeId) => {
        calls.setMode.push(modeId);
        return true;
      },
      prompt: (text) => {
        calls.prompt.push(text);
        return true;
      },
      cancel: () => {
        calls.cancel += 1;
      },
    },
    pendingMode: null,
    confirmedMode: null,
    heldPrompt: null,
    modeRpcSessionId: null,
    activeSessionId: id || null,
    viewingSessionId: id || null,
  };
  return { state, calls };
}

/**
 * Zustand-shaped set/get over a ModeHoldState object.
 * @param state Mutable slice.
 */
function bind(state: ModeHoldState): {
  set: (partial: Partial<ModeHoldState> | ((s: ModeHoldState) => Partial<ModeHoldState>)) => void;
  get: () => ModeHoldState;
} {
  return {
    get: () => state,
    set: (partial) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      Object.assign(state, patch);
      if (patch.session) {
        state.session = patch.session;
      }
    },
  };
}

/** Local unconfirmed user row, the kind rollback is allowed to remove. */
function localUser(text: string) {
  return {
    kind: "user" as const,
    id: "u1",
    blocks: [{ type: "text" as const, text }],
    origin: "local" as const,
    agentConfirmed: false,
    clientPromptId: "p1",
  };
}

describe("modeFromReadyInfo", () => {
  it("accepts only the bridge line emitted after session/set_mode", () => {
    assert.equal(modeFromReadyInfo("mode set to plan"), "plan");
    assert.equal(modeFromReadyInfo("mode set to ask"), "ask");
    assert.equal(modeFromReadyInfo("session sess ready"), null);
    assert.equal(modeFromReadyInfo("mode set to yolo"), null);
  });
});

describe("beginModeSwitch", () => {
  it("paints the chip immediately and asks the bridge", () => {
    const { state, calls } = makeState("build");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "plan");
    assert.equal(state.session.mode, "plan");
    assert.equal(state.pendingMode, "plan");
    assert.equal(state.confirmedMode, "build");
    assert.deepEqual(calls.setMode, ["plan"]);
    assert.equal(state.modeRpcSessionId, "sess-1");
  });

  it("does not call the bridge on a New chat draft", () => {
    const { state, calls } = makeState("build", "");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "ask");
    assert.equal(state.session.mode, "ask");
    assert.equal(state.pendingMode, "ask");
    assert.equal(calls.setMode.length, 0);
    assert.equal(state.modeRpcSessionId, null);
  });
});

describe("pinModeHoldOnCanvas", () => {
  it("keeps the user's mode and the pretended streaming status", () => {
    const canvas = createSessionState({ id: "sess-1", workspace: "/w", mode: "build" });
    canvas.status = "idle";
    const held: HeldPrompt = { text: "hi", sessionId: "sess-1" };
    const pinned = pinModeHoldOnCanvas(canvas, "plan", held);
    assert.equal(pinned.mode, "plan");
    assert.equal(pinned.status, "streaming");
  });
});

describe("defer and ready", () => {
  it("holds the prompt until mode set to matches, then sends once", () => {
    const { state, calls } = makeState("build");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "plan");
    const held = deferPromptForPendingMode(set, get, "hello", undefined, "sess-1");
    assert.equal(held, true);
    assert.equal(calls.prompt.length, 0);
    assert.equal(state.heldPrompt?.text, "hello");
    noteModeReadyInfo(set, get, "mode set to build", "sess-1");
    assert.equal(calls.prompt.length, 0);
    assert.equal(state.pendingMode, "plan");
    noteModeReadyInfo(set, get, "mode set to plan", "other");
    assert.equal(calls.prompt.length, 0);
    noteModeReadyInfo(set, get, "mode set to plan", "sess-1");
    assert.deepEqual(calls.prompt, ["hello"]);
    assert.equal(state.pendingMode, null);
    assert.equal(state.heldPrompt, null);
  });

  it("fires set_mode on first send when the draft had no session yet", () => {
    const { state, calls } = makeState("build", "");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "ask");
    state.session = { ...state.session, id: "sess-new" };
    const held = deferPromptForPendingMode(set, get, "q", undefined, "sess-new");
    assert.equal(held, true);
    assert.deepEqual(calls.setMode, ["ask"]);
    assert.equal(calls.prompt.length, 0);
    noteModeReadyInfo(set, get, "mode set to ask", "sess-new");
    assert.deepEqual(calls.prompt, ["q"]);
  });
});

describe("failure and cancel", () => {
  it("reverts the chip and drops the bubble instead of sending", () => {
    const { state, calls } = makeState("build");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "plan");
    state.session = {
      ...state.session,
      status: "streaming",
      timeline: [localUser("hello")],
    };
    deferPromptForPendingMode(set, get, "hello", undefined, "sess-1");
    failModeSwitch(set, get, "");
    assert.equal(state.session.mode, "build");
    assert.equal(state.pendingMode, null);
    assert.equal(state.heldPrompt, null);
    assert.equal(state.session.timeline.length, 0);
    assert.equal(state.session.status, "idle");
    assert.equal(calls.prompt.length, 0);
    assert.match(String(state.bridgeInfo), /not sent/);
  });

  it("cancel of a held prompt does not call session/cancel", () => {
    const { state, calls } = makeState("build");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "plan");
    state.session = {
      ...state.session,
      status: "streaming",
      timeline: [localUser("hello")],
    };
    deferPromptForPendingMode(set, get, "hello", undefined, "sess-1");
    const released = cancelTurnAction(set, get);
    assert.equal(released, true);
    assert.equal(calls.cancel, 0);
    assert.equal(state.session.mode, "plan");
    assert.equal(state.pendingMode, "plan");
    assert.equal(state.session.timeline.length, 0);
    assert.equal(state.session.status, "idle");
  });

  it("restart_required for mode reverts and does not send", () => {
    const { state, calls } = makeState("build");
    const { set, get } = bind(state);
    beginModeSwitch(set, get, "ask");
    noteModeRestartRequired(set, get, "mode", "session/set_mode is not supported");
    assert.equal(state.session.mode, "build");
    assert.equal(state.pendingMode, null);
    assert.equal(calls.prompt.length, 0);
    assert.equal(state.bridgeInfo, "session/set_mode is not supported");
  });
});
