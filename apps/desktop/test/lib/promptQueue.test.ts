import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearQueueForSession,
  countQueueForSession,
  dequeuePromptForSession,
  dequeuePromptText,
  enqueuePromptText,
  planSendQueuedNow,
  prioritizeQueuedById,
  queueForSession,
  removeQueuedAt,
  removeQueuedById,
  takeQueuedById,
  type PromptQueueItem,
} from "@/lib/promptQueue";

/**
 * Build a queue row with a fixed id for reorder / Send now tests.
 * @param id Row id.
 * @param sessionId Owning session.
 * @param text Prompt text.
 */
function item(id: string, sessionId: string, text: string): PromptQueueItem {
  return { id, sessionId, text };
}

describe("promptQueue", () => {
  it("enqueues per session and ignores empty", () => {
    let q: PromptQueueItem[] = [];
    q = enqueuePromptText(q, "s1", "a", "a1");
    q = enqueuePromptText(q, "s1", "  b  ", "b1");
    q = enqueuePromptText(q, "s1", "   ");
    q = enqueuePromptText(q, "s2", "c", "c1");
    assert.equal(q.length, 3);
    assert.equal(countQueueForSession(q, "s1"), 2);
    assert.equal(countQueueForSession(q, "s2"), 1);
    assert.ok(q[0]?.id);
    assert.notEqual(q[0]?.id, q[1]?.id);
  });

  it("dequeues only the target session", () => {
    let q: PromptQueueItem[] = [
      item("a", "s1", "a"),
      item("b", "s2", "b"),
      item("c", "s1", "c"),
    ];
    const first = dequeuePromptForSession(q, "s1");
    assert.equal(first.head, "a");
    q = first.rest;
    const second = dequeuePromptForSession(q, "s2");
    assert.equal(second.head, "b");
    q = second.rest;
    assert.deepEqual(q, [item("c", "s1", "c")]);
  });

  it("clears one session without touching others", () => {
    const q = clearQueueForSession(
      [item("a", "s1", "a"), item("b", "s2", "b")],
      "s1",
    );
    assert.deepEqual(q, [item("b", "s2", "b")]);
  });

  it("legacy head dequeue and removeQueuedAt still work", () => {
    const { head, rest } = dequeuePromptText([
      item("a", "s1", "a"),
      item("b", "s1", "b"),
    ]);
    assert.equal(head, "a");
    assert.equal(rest.length, 1);
    assert.deepEqual(removeQueuedAt(rest, 0), []);
  });

  it("queueForSession filters canvas rows in enqueue order", () => {
    const q = [
      item("a", "s1", "one"),
      item("b", "s2", "other"),
      item("c", "s1", "two"),
    ];
    assert.deepEqual(
      queueForSession(q, "s1").map((row) => row.text),
      ["one", "two"],
    );
    assert.deepEqual(queueForSession(q, ""), []);
  });

  it("take / remove by id leave other sessions intact", () => {
    const q = [
      item("a", "s1", "one"),
      item("b", "s2", "other"),
      item("c", "s1", "two"),
    ];
    const taken = takeQueuedById(q, "a");
    assert.equal(taken.item?.text, "one");
    assert.deepEqual(
      taken.rest.map((row) => row.id),
      ["b", "c"],
    );
    assert.deepEqual(
      removeQueuedById(q, "missing"),
      q,
    );
  });

  it("prioritizeQueuedById moves a row to the front of its session", () => {
    const q = [
      item("a", "s1", "one"),
      item("x", "s2", "other"),
      item("b", "s1", "two"),
    ];
    const next = prioritizeQueuedById(q, "b");
    // b takes the first s1 slot; a slides behind; s2 keeps its place after.
    assert.deepEqual(
      next.map((row) => row.id),
      ["b", "a", "x"],
    );
  });

  it("planSendQueuedNow interrupts when busy and sends when idle", () => {
    const q = [item("a", "s1", "one"), item("b", "s1", "two")];
    const busy = planSendQueuedNow(q, "b", true);
    assert.equal(busy.kind, "interrupt");
    if (busy.kind === "interrupt") {
      assert.equal(busy.queue[0]?.id, "b");
      assert.equal(busy.queue.length, 2);
    }
    const idle = planSendQueuedNow(q, "b", false);
    assert.equal(idle.kind, "send");
    if (idle.kind === "send") {
      assert.equal(idle.text, "two");
      assert.deepEqual(
        idle.queue.map((row) => row.id),
        ["a"],
      );
    }
    assert.equal(planSendQueuedNow(q, "missing", true).kind, "none");
  });
});
