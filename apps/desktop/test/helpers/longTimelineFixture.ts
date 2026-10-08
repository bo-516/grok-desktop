/**
 * Synthetic long session for timeline perf tests.
 * User + thought + read tool + fenced answer, repeated. No math delimiters,
 * so KaTeX stays unloaded. Not a product fixture — tests only.
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";

/** Default length for the long-session measurement. */
export const LONG_SESSION_TURNS = 200;

export type LongSession = {
  /** Ordered timeline rows. */
  timeline: TimelineItem[];
  /** Tool cards keyed by toolCallId. The object is stable until a test clones it. */
  toolCalls: Record<string, ToolCallCard>;
};

/**
 * Build `turnCount` settled-looking turns. The last turn is the one tests
 * append agent chunks onto.
 * @param turnCount How many user/assistant spans. 0 returns empty lists.
 *   A negative count throws — callers pass a non-negative integer.
 */
export function buildLongSession(turnCount: number): LongSession {
  if (turnCount < 0 || !Number.isInteger(turnCount)) {
    throw new Error(`turnCount must be a non-negative integer, got ${turnCount}`);
  }
  const timeline: TimelineItem[] = [];
  const toolCalls: Record<string, ToolCallCard> = {};
  for (let index = 0; index < turnCount; index += 1) {
    const toolCallId = `tc-${index}`;
    timeline.push({
      kind: "user",
      id: `user-${index}`,
      blocks: [{ type: "text", text: `Question ${index} about the parser` }],
    });
    timeline.push({
      kind: "thought",
      id: `thought-${index}`,
      text: "Checking the file.",
      collapsed: true,
      startedAt: index,
      completedAt: index + 1,
    });
    timeline.push({ kind: "tool", id: `tool-${index}`, toolCallId });
    timeline.push({
      kind: "agent",
      id: `agent-${index}`,
      text: answerText(index),
    });
    toolCalls[toolCallId] = {
      toolCallId,
      kind: "read",
      status: "completed",
      title: `Read src/file${index}.ts`,
      content: [{ type: "content", text: `export const value${index} = ${index};\n` }],
    };
  }
  return { timeline, toolCalls };
}

/**
 * Agent answer with one small fenced block. Kept free of `$` so math does not load.
 * @param index Turn index, embedded so each answer is distinct.
 */
export function answerText(index: number): string {
  return [
    `Answer ${index}.`,
    "",
    "```ts",
    `export function f${index}(value: number) {`,
    `  return value + ${index};`,
    "}",
    "```",
    "",
  ].join("\n");
}

/**
 * Append text to the tail agent row, preserving every earlier item reference.
 * Mirrors `appendOrMergeAgentText` for a live non-seed agent tail.
 * @param timeline Timeline that ends in an agent row. Any other shape throws.
 * @param chunk Non-empty text to append. Empty still copies the tail (a no-op
 *   growth) so callers can see identity separate from string length.
 */
export function appendAgentChunk(
  timeline: TimelineItem[],
  chunk: string,
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (!last || last.kind !== "agent") {
    throw new Error("long session must end on an agent row");
  }
  return [
    ...timeline.slice(0, -1),
    { ...last, text: last.text + chunk },
  ];
}
