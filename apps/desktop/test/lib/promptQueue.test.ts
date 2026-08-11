import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearQueueForSession,
  countQueueForSession,
  dequeuePromptForSession,
  dequeuePromptText,
  enqueuePromptText,
  removeQueuedAt,
  type PromptQueueItem,
} from "@/lib/promptQueue";

describe("promptQueue", () => {
  it("enqueues per session and ignores empty", () => {
    let q: PromptQueueItem[] = [];
    q = enqueuePromptText(q, "s1", "a");
    q = enqueuePromptText(q, "s1", "  b  ");
    q = enqueuePromptText(q, "s1", "   ");
    q = enqueuePromptText(q, "s2", "c");
    assert.equal(q.length, 3);
    assert.equal(countQueueForSession(q, "s1"), 2);
    assert.equal(countQueueForSession(q, "s2"), 1);
  });

  it("dequeues only the target session", () => {
    let q: PromptQueueItem[] = [
      { sessionId: "s1", text: "a" },
      { sessionId: "s2", text: "b" },
      { sessionId: "s1", text: "c" },
    ];
    const first = dequeuePromptForSession(q, "s1");
    assert.equal(first.head, "a");
    q = first.rest;
    const second = dequeuePromptForSession(q, "s2");
    assert.equal(second.head, "b");
    q = second.rest;
    assert.deepEqual(q, [{ sessionId: "s1", text: "c" }]);
  });

  it("clears one session without touching others", () => {
    const q = clearQueueForSession(
      [
        { sessionId: "s1", text: "a" },
        { sessionId: "s2", text: "b" },
      ],
      "s1",
    );
    assert.deepEqual(q, [{ sessionId: "s2", text: "b" }]);
  });

  it("legacy head dequeue and removeQueuedAt still work", () => {
    const { head, rest } = dequeuePromptText([
      { sessionId: "s1", text: "a" },
      { sessionId: "s1", text: "b" },
    ]);
    assert.equal(head, "a");
    assert.equal(rest.length, 1);
    assert.deepEqual(removeQueuedAt(rest, 0), []);
  });
});
