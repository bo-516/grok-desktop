/**
 * Change-set aggregation over ACP tool-call diff fragments (S1).
 * Drives shipped buildChangeSetFromToolCalls / buildTurnChangeSet.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import {
  buildChangeSetFromToolCalls,
  buildSessionChangeSet,
  buildTurnChangeSetById,
  indexTurnsById,
} from "@/lib/changeSet";

function card(
  partial: Partial<ToolCallCard> & { toolCallId: string },
): ToolCallCard {
  return {
    toolCallId: partial.toolCallId,
    kind: partial.kind ?? "edit",
    status: partial.status ?? "completed",
    title: partial.title,
    content: partial.content,
    rawLocations: partial.rawLocations,
    meta: partial.meta,
  };
}

describe("changeSet aggregation", () => {
  it("merges multi-tool-call same path: first oldText + last newText", () => {
    const toolCalls: Record<string, ToolCallCard> = {
      t1: card({
        toolCallId: "t1",
        content: [
          {
            type: "diff",
            path: "src/a.ts",
            oldText: "v0\n",
            newText: "v1\n",
          },
        ],
      }),
      t2: card({
        toolCallId: "t2",
        content: [
          {
            type: "diff",
            path: "src/a.ts",
            oldText: "v1\n",
            newText: "v2\n",
          },
        ],
      }),
    };
    const set = buildChangeSetFromToolCalls(toolCalls, ["t1", "t2"]);
    assert.equal(set.fileCount, 1);
    const f = set.files[0]!;
    assert.equal(f.path, "src/a.ts");
    assert.equal(f.baseText, "v0\n");
    assert.equal(f.headText, "v2\n");
    assert.deepEqual(f.toolCallIds, ["t1", "t2"]);
    // v0 → v2 is one line rewrite
    assert.equal(f.added, 1);
    assert.equal(f.removed, 1);
  });

  it("missing oldText marks no_baseline", () => {
    const toolCalls: Record<string, ToolCallCard> = {
      t1: card({
        toolCallId: "t1",
        content: {
          type: "diff",
          path: "new.ts",
          newText: "hello\nworld\n",
        },
      }),
    };
    const set = buildChangeSetFromToolCalls(toolCalls, ["t1"]);
    assert.equal(set.files[0]!.status, "no_baseline");
    assert.equal(set.files[0]!.added, 2);
    assert.equal(set.files[0]!.removed, 0);
  });

  it("edit without diff content is listed as no_diff_data", () => {
    const toolCalls: Record<string, ToolCallCard> = {
      t1: card({
        toolCallId: "t1",
        kind: "edit",
        title: "sed rewrite",
        rawLocations: ["src/shell.ts"],
        content: { type: "content", text: "ran sed" },
      }),
    };
    const set = buildChangeSetFromToolCalls(toolCalls, ["t1"]);
    assert.equal(set.fileCount, 1);
    assert.equal(set.files[0]!.path, "src/shell.ts");
    assert.equal(set.files[0]!.status, "no_diff_data");
    assert.equal(set.files[0]!.added, 0);
    assert.equal(set.files[0]!.removed, 0);
  });

  it("session change set aggregates multiple paths", () => {
    const toolCalls: Record<string, ToolCallCard> = {
      a: card({
        toolCallId: "a",
        content: {
          type: "diff",
          path: "a.ts",
          oldText: "1\n",
          newText: "2\n",
        },
      }),
      b: card({
        toolCallId: "b",
        content: {
          type: "diff",
          path: "b.ts",
          oldText: "x\n",
          newText: "y\n",
        },
      }),
    };
    const set = buildSessionChangeSet(toolCalls, ["a", "b"]);
    assert.equal(set.fileCount, 2);
    assert.equal(set.added, 2);
    assert.equal(set.removed, 2);
  });

  it("buildChangeSetFromToolCalls with captured toolCallIds matches turn open path", () => {
    // TurnBlockWidget now passes collectToolCallIdsFromTurn into openPreview.
    const toolCalls: Record<string, ToolCallCard> = {
      "tc-a": card({
        toolCallId: "tc-a",
        content: {
          type: "diff",
          path: "a.ts",
          oldText: "1\n",
          newText: "2\n",
        },
      }),
      "tc-b": card({
        toolCallId: "tc-b",
        content: {
          type: "diff",
          path: "b.ts",
          oldText: "x\n",
          newText: "y\n",
        },
      }),
      "tc-other": card({
        toolCallId: "tc-other",
        content: {
          type: "diff",
          path: "other.ts",
          oldText: "o\n",
          newText: "p\n",
        },
      }),
    };
    // Only the turn's tools — not the whole session.
    const set = buildChangeSetFromToolCalls(toolCalls, ["tc-a", "tc-b"]);
    assert.equal(set.fileCount, 2);
    assert.ok(set.files.every((f) => f.path !== "other.ts"));
  });

  it("indexTurnsById + buildTurnChangeSetById resolve turn-end openPreview path", () => {
    // Same pipeline TimelineView / TurnBlockWidget use for unit.id.
    const timeline: TimelineItem[] = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "edit files" }],
      },
      { kind: "tool", id: "tool-row-1", toolCallId: "tc-edit-1" },
      { kind: "tool", id: "tool-row-2", toolCallId: "tc-edit-2" },
      { kind: "agent", id: "a1", text: "done" },
    ];
    const toolCalls: Record<string, ToolCallCard> = {
      "tc-edit-1": card({
        toolCallId: "tc-edit-1",
        content: {
          type: "diff",
          path: "src/one.ts",
          oldText: "a\n",
          newText: "b\n",
        },
      }),
      "tc-edit-2": card({
        toolCallId: "tc-edit-2",
        content: {
          type: "diff",
          path: "src/two.ts",
          oldText: "x\n",
          newText: "y\n",
        },
      }),
    };
    const byId = indexTurnsById(timeline, toolCalls);
    const turnIds = Object.keys(byId);
    assert.equal(turnIds.length, 1);
    const turnId = turnIds[0]!;
    // TurnBlockWidget opens preview with this turn id.
    const set = buildTurnChangeSetById(turnId, timeline, toolCalls);
    assert.ok(set);
    assert.equal(set!.fileCount, 2);
    assert.equal(set!.added, 2);
    assert.equal(set!.removed, 2);
    assert.ok(set!.files.some((f) => f.path === "src/one.ts"));
    assert.ok(set!.files.some((f) => f.path === "src/two.ts"));
    // Unknown turn id must fail closed (drawer shows error, not empty list).
    assert.equal(
      buildTurnChangeSetById("turn-missing", timeline, toolCalls),
      null,
    );
  });
});
