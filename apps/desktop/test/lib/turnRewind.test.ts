/**
 * Turn → grok-build rewind boundary matching, the restore file plan, and the
 * bridge `rewind_*` calls / payload normalization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import type { GitCliRunner } from "@/lib/gitBridge";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import {
  conflictLabel,
  hasSnapshotsFrom,
  matchRewindPoint,
  normalizePromptText,
  previewMatches,
  promptAnchors,
  rewindFilePlan,
  type RewindPoint,
} from "@/lib/turnRewind";
import {
  fetchRewindPoints,
  normalizeRewindPoints,
  normalizeRewindResult,
  runRewindFiles,
} from "@/lib/turnRewindBridge";

/**
 * Edit card with one diff fragment.
 * @param id Tool call id.
 * @param path Diff path.
 */
function editCard(id: string, path: string): ToolCallCard {
  return {
    toolCallId: id,
    kind: "edit",
    status: "completed",
    title: `Edit ${path}`,
    content: [{ type: "diff", path, oldText: "a\n", newText: "b\n" }],
  } as ToolCallCard;
}

/**
 * Timeline of prompts, each followed by its tool rows and an answer.
 * @param turns [prompt text, tool ids] per turn.
 */
function timelineOf(turns: Array<[string, string[]]>): TimelineItem[] {
  const items: TimelineItem[] = [];
  turns.forEach(([text, ids], t) => {
    items.push({ id: `u${t}`, kind: "user", blocks: [{ type: "text", text }] } as TimelineItem);
    for (const id of ids) {
      items.push({ id: `tool-${id}`, kind: "tool", toolCallId: id } as unknown as TimelineItem);
    }
    items.push({ id: `a${t}`, kind: "agent", text: "done" } as unknown as TimelineItem);
  });
  return items;
}

/**
 * Rewind point shorthand.
 * @param promptIndex Ordinal.
 * @param preview Preview text.
 * @param fileCount Snapshot count.
 */
function point(promptIndex: number, preview: string, fileCount = 1): RewindPoint {
  return { promptIndex, preview, createdAt: "", fileCount, hasFileChanges: fileCount > 0 };
}

const toolCalls = {
  t1: editCard("t1", "/repo/a.ts"),
  t2: editCard("t2", "/repo/b.ts"),
  t3: editCard("t3", "/repo/a.ts"),
  t4: editCard("t4", "/elsewhere/z.ts"),
};

describe("preview matching", () => {
  it("normalizes ellipsis and whitespace", () => {
    assert.equal(normalizePromptText("Fix   the\nbug..."), "Fix the bug");
    assert.equal(normalizePromptText("Fix it…"), "Fix it");
    assert.ok(previewMatches("Use your file edit/write tools (not the shell): replace t...", "Use your file edit/write tools (not the shell): replace the file"));
    assert.ok(previewMatches("multi line", "multi\nline prompt"));
    assert.ok(!previewMatches("", "anything"));
    assert.ok(!previewMatches("other...", "prompt"));
  });
});

describe("matchRewindPoint", () => {
  const timeline = timelineOf([
    ["first task", ["t1"]],
    ["again", ["t2"]],
    ["third", []],
    ["again", ["t3"]],
  ]);
  const anchors = promptAnchors(buildTimelineRenderUnits(timeline, toolCalls));

  it("pairs every prompt with the turn after it", () => {
    assert.equal(anchors.length, 4);
    assert.ok(anchors.every((a) => a.turnId !== ""));
  });

  it("matches by preview and aligns repeated prompts from the end", () => {
    // Timeline started after prompt 0 of the session: indices are offset.
    const points = [point(1, "first task"), point(2, "again"), point(3, "third", 0), point(4, "again")];
    const id = (i: number) => anchors[i]?.turnId ?? "";
    assert.deepEqual(matchRewindPoint(anchors, id(0), points), { ok: true, point: points[0] });
    assert.deepEqual(matchRewindPoint(anchors, id(1), points), { ok: true, point: points[1] });
    assert.deepEqual(matchRewindPoint(anchors, id(3), points), { ok: true, point: points[3] });
  });

  it("explains a missing checkpoint or unknown turn", () => {
    const miss = matchRewindPoint(anchors, anchors[0]?.turnId ?? "", [point(0, "unrelated")]);
    assert.equal(miss.ok, false);
    assert.equal(matchRewindPoint(anchors, "nope", []).ok, false);
  });

  it("knows when nothing is left to restore", () => {
    const points = [point(0, "a", 1), point(1, "b", 0)];
    assert.ok(hasSnapshotsFrom(points, 0));
    assert.ok(!hasSnapshotsFrom(points, 1));
  });
});

describe("rewindFilePlan", () => {
  it("lists files of the turn and later turns, relative to the workspace", () => {
    const timeline = timelineOf([
      ["one", ["t1"]],
      ["two", ["t2", "t3"]],
      ["three", ["t4"]],
    ]);
    const units = buildTimelineRenderUnits(timeline, toolCalls);
    const turnIds = units.flatMap((u) => (u.type === "turn" ? [u.id] : []));
    const fromSecond = rewindFilePlan(timeline, toolCalls, turnIds[1] ?? "", "/repo");
    assert.deepEqual(fromSecond, { files: ["b.ts", "a.ts", "/elsewhere/z.ts"], laterTurns: 1 });
    const fromFirst = rewindFilePlan(timeline, toolCalls, turnIds[0] ?? "", "/repo");
    assert.equal(fromFirst.laterTurns, 2);
    assert.deepEqual(rewindFilePlan(timeline, toolCalls, "missing", "/repo"), { files: [], laterTurns: 0 });
  });
});

describe("conflictLabel", () => {
  it("names grok-build conflict types", () => {
    assert.equal(conflictLabel("modified_externally"), "edited outside the agent");
    assert.equal(conflictLabel("deleted_externally"), "deleted outside the agent");
    assert.equal(conflictLabel("weird_kind"), "weird kind");
    assert.equal(conflictLabel(""), "changed outside the agent");
  });
});

describe("rewind bridge calls", () => {
  it("sends rewind_points / rewind_files and normalizes replies", async () => {
    const calls: Array<{ command: string; args: unknown; cwd: string }> = [];
    const run: GitCliRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "rewind_points") {
        return { ok: true, data: [{ promptIndex: 0, preview: "hi", createdAt: "t", fileCount: 2, hasFileChanges: true }, { preview: "bad" }] };
      }
      return {
        ok: true,
        data: { success: false, targetPromptIndex: 0, revertedFiles: [], cleanFiles: ["b.txt"], conflicts: [{ path: "a.txt", type: "modified_externally" }], error: "External modifications detected." },
      };
    };
    const points = await fetchRewindPoints(run, "/ws", "s1");
    assert.deepEqual(points, [{ promptIndex: 0, preview: "hi", createdAt: "t", fileCount: 2, hasFileChanges: true }]);
    const res = await runRewindFiles(run, "/ws", { sessionId: "s1", targetPromptIndex: 0, force: false });
    assert.equal(res.success, false);
    assert.deepEqual(res.conflicts, [{ path: "a.txt", type: "modified_externally" }]);
    assert.deepEqual(res.cleanFiles, ["b.txt"]);
    assert.deepEqual(calls[1], { command: "rewind_files", args: { sessionId: "s1", targetPromptIndex: 0, force: false }, cwd: "/ws" });
  });

  it("throws the bridge error verbatim", async () => {
    const run: GitCliRunner = async () => ({ ok: false, error: "session not in pool: s1" });
    await assert.rejects(fetchRewindPoints(run, "/ws", "s1"), /session not in pool/);
  });

  it("tolerates malformed payloads", () => {
    assert.deepEqual(normalizeRewindPoints("x"), []);
    const res = normalizeRewindResult(null);
    assert.equal(res.success, false);
    assert.ok(res.error.length > 0);
    const ok = normalizeRewindResult({ success: true, revertedFiles: ["a", 1], deletedFiles: ["c"], error: "ignored" });
    assert.deepEqual([ok.success, ok.revertedFiles, ok.deletedFiles, ok.error], [true, ["a"], ["c"], ""]);
  });
});
