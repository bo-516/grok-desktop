import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dequeuePromptText,
  enqueuePromptText,
  removeQueuedAt,
} from "@/lib/promptQueue";

describe("promptQueue", () => {
  it("enqueues non-empty text in order", () => {
    let q: string[] = [];
    q = enqueuePromptText(q, "a");
    q = enqueuePromptText(q, "  b  ");
    q = enqueuePromptText(q, "   ");
    assert.deepEqual(q, ["a", "b"]);
  });

  it("dequeues FIFO", () => {
    const { head, rest } = dequeuePromptText(["a", "b"]);
    assert.equal(head, "a");
    assert.deepEqual(rest, ["b"]);
  });

  it("removes by index", () => {
    assert.deepEqual(removeQueuedAt(["a", "b", "c"], 1), ["a", "c"]);
  });
});
