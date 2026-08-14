/**
 * Composer queue actions: Cancel removes a row; Send now interrupts a busy
 * turn and leaves the row first so the idle drain delivers it next.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import type { PromptQueueItem } from "@/lib/promptQueue";
import {
  isCanvasTurnBusy,
  removeQueuedPromptAction,
  sendQueuedNowAction,
} from "@/store/sessionStoreQueue";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "@/store/sessionStoreTypes";

/**
 * Build a queue row for action tests.
 * @param id Row id.
 * @param text Prompt text.
 * @param sessionId Owning session (default s1).
 */
function row(
  id: string,
  text: string,
  sessionId = "s1",
): PromptQueueItem {
  return { id, sessionId, text };
}

/**
 * Minimal store slice for queue actions (cancel / busy / remove).
 * @param partial Overrides (promptQueue, status, live.cancel).
 */
function makeStore(partial: {
  promptQueue: PromptQueueItem[];
  status?: "idle" | "streaming" | "waiting_permission";
  poolStatus?: "idle" | "streaming" | "waiting_permission";
  cancelled?: string[];
}): { set: SessionStoreSet; get: SessionStoreGet } {
  const cancelled = partial.cancelled ?? [];
  const session = createSessionState({
    id: "s1",
    workspace: "/w",
  });
  session.status = partial.status ?? "streaming";
  let state = {
    session,
    viewingSessionId: "s1",
    activeSessionId: "s1",
    promptQueue: partial.promptQueue,
    poolEntries: partial.poolStatus
      ? [{ sessionId: "s1", status: partial.poolStatus }]
      : [],
    live: {
      cancel: (sid?: string) => {
        cancelled.push(sid ?? "");
      },
      prompt: () => true,
    },
    connectionMode: "live-bridge",
    lastError: null,
  } as unknown as SessionStore;
  const set: SessionStoreSet = (partialOrFn) => {
    const next =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...next };
  };
  const get: SessionStoreGet = () => state;
  return { set, get };
}

describe("sessionStoreQueue", () => {
  it("isCanvasTurnBusy follows session and pool status", () => {
    const streaming = makeStore({
      promptQueue: [],
      status: "streaming",
    });
    assert.equal(isCanvasTurnBusy(streaming.get), true);
    const idle = makeStore({ promptQueue: [], status: "idle" });
    assert.equal(isCanvasTurnBusy(idle.get), false);
    const poolBusy = makeStore({
      promptQueue: [],
      status: "idle",
      poolStatus: "streaming",
    });
    assert.equal(isCanvasTurnBusy(poolBusy.get), true);
  });

  it("removeQueuedPromptAction returns text and drops only that row", () => {
    const store = makeStore({
      promptQueue: [row("a", "one"), row("b", "two")],
    });
    const text = removeQueuedPromptAction(store.set, store.get, "a");
    assert.equal(text, "one");
    assert.deepEqual(
      store.get().promptQueue.map((item) => item.id),
      ["b"],
    );
    assert.equal(removeQueuedPromptAction(store.set, store.get, "gone"), null);
  });

  it("sendQueuedNowAction on a busy turn prioritizes the row and cancels", () => {
    const cancelled: string[] = [];
    const store = makeStore({
      promptQueue: [row("a", "one"), row("b", "two")],
      status: "streaming",
      cancelled,
    });
    sendQueuedNowAction(store.set, store.get, "b");
    assert.deepEqual(
      store.get().promptQueue.map((item) => item.id),
      ["b", "a"],
    );
    assert.deepEqual(cancelled, ["s1"]);
    assert.match(store.get().bridgeInfo, /Sending now/);
  });

  it("sendQueuedNowAction ignores an unknown id", () => {
    const cancelled: string[] = [];
    const store = makeStore({
      promptQueue: [row("a", "one")],
      cancelled,
    });
    sendQueuedNowAction(store.set, store.get, "missing");
    assert.equal(store.get().promptQueue.length, 1);
    assert.deepEqual(cancelled, []);
  });
});
