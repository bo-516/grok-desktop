import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTodos, todosAllDone } from "@/lib/todos";

describe("todos", () => {
  it("normalizes mixed shapes", () => {
    const list = normalizeTodos([
      { content: "A", status: "pending" },
      { title: "B", status: "in_progress" },
      "C",
    ]);
    assert.equal(list.length, 3);
    assert.equal(list[1]?.content, "B");
  });

  it("detects all done", () => {
    assert.equal(
      todosAllDone([
        { id: "1", content: "a", status: "completed" },
        { id: "2", content: "b", status: "cancelled" },
      ]),
      true,
    );
    assert.equal(
      todosAllDone([{ id: "1", content: "a", status: "pending" }]),
      false,
    );
  });
});
