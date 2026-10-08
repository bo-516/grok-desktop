/**
 * Turn attribution for the git change list: tool-card paths mapped onto
 * repo-relative git paths and grouped by turn.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import {
  buildGitTurnAttribution,
  pathsTouchedByToolCalls,
  toRepoRelativePath,
} from "@/lib/gitAttribution";

describe("toRepoRelativePath", () => {
  it("maps absolute, relative and file:// paths into the repo", () => {
    assert.equal(toRepoRelativePath("/repo/src/a.ts", "/repo", "/repo"), "src/a.ts");
    assert.equal(toRepoRelativePath("src/a.ts", "/repo", "/repo/pkg"), "pkg/src/a.ts");
    assert.equal(toRepoRelativePath("file:///repo/b.ts", "/repo", "/repo"), "b.ts");
    assert.equal(toRepoRelativePath("../x/../c.ts", "/repo", "/repo/pkg"), "c.ts");
  });
  it("matches macOS /private aliases and Windows separators", () => {
    assert.equal(toRepoRelativePath("/var/t/repo/a.ts", "/private/var/t/repo", "/var/t/repo"), "a.ts");
    assert.equal(toRepoRelativePath("C:\\work\\repo\\a.ts", "C:/work/repo", "C:/work/repo"), "a.ts");
  });
  it("rejects paths outside the repo and placeholders", () => {
    assert.equal(toRepoRelativePath("/elsewhere/a.ts", "/repo", "/repo"), null);
    assert.equal(toRepoRelativePath("/repo-evil/a.ts", "/repo", "/repo"), null);
    assert.equal(toRepoRelativePath("(unknown)", "/repo", "/repo"), null);
    assert.equal(toRepoRelativePath("/repo/a.ts", "", "/repo"), null);
  });
});

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
 * Minimal timeline: user prompt then one tool row per id.
 * @param turns Tool ids per turn.
 */
function timelineOf(turns: string[][]): TimelineItem[] {
  const items: TimelineItem[] = [];
  turns.forEach((ids, t) => {
    items.push({ id: `u${t}`, kind: "user", text: `prompt ${t}` } as unknown as TimelineItem);
    for (const id of ids) {
      items.push({ id: `tool-${id}`, kind: "tool", toolCallId: id } as unknown as TimelineItem);
    }
    items.push({ id: `a${t}`, kind: "agent", text: "done" } as unknown as TimelineItem);
  });
  return items;
}

describe("buildGitTurnAttribution", () => {
  it("lists every turn that touched a path, in order", () => {
    const toolCalls = {
      t1: editCard("t1", "/repo/a.ts"),
      t2: editCard("t2", "/repo/b.ts"),
      t3: editCard("t3", "/repo/a.ts"),
    };
    const map = buildGitTurnAttribution(timelineOf([["t1"], ["t2", "t3"]]), toolCalls, "/repo", "/repo");
    assert.deepEqual(map.get("a.ts")?.map((r) => r.index), [1, 2]);
    assert.deepEqual(map.get("b.ts")?.map((r) => r.index), [2]);
    assert.equal(buildGitTurnAttribution([], toolCalls, "", "/repo").size, 0);
  });

  it("collects paths for a captured tool-call id list", () => {
    const toolCalls = { t1: editCard("t1", "/repo/a.ts"), t2: editCard("t2", "/outside/z.ts") };
    assert.deepEqual([...pathsTouchedByToolCalls(toolCalls, ["t1", "t2", "missing"], "/repo", "/repo")], ["a.ts"]);
  });
});
