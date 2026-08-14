/**
 * Convert grok-build `chat_history.jsonl` objects into a seed SessionState.
 * Isolated from the payload/reduce entry so the history module stays under
 * the file-size cap.
 */

import {
  createSessionState,
  tagSeedUserMessages,
  type AgentMode,
  type ContentBlock,
  type SessionState,
  type TimelineItem,
  type ToolCallCard,
} from "@grok-desktop/acp-core";

/** Max characters of one tool_result kept on a disk-hydrated card. */
export const DISK_TOOL_RESULT_MAX = 4000;

/** Identity stamped onto a disk-hydrated snapshot. */
export type SessionHistoryIdentity = {
  sessionId: string;
  workspace: string;
  model?: string;
  mode?: AgentMode;
  title?: string;
};

/**
 * Extract `<user_query>` when present; drop harness context dumps.
 * Reminder-only rows are left for {@link tagSeedUserMessages} to strip.
 * @param text Raw chat_history user text.
 * @returns Display body, or empty when the row should be dropped now.
 */
export function displayUserText(text: string): string {
  const match = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  if (isHarnessContextDump(text)) {
    return "";
  }
  if (/^\[Image extracted from tool result/i.test(text.trim())) {
    return "";
  }
  return text;
}

/**
 * True when the row is a grok-build context pack (user_info / git_status)
 * and not a real user prompt.
 * @param text Raw user content.
 */
export function isHarnessContextDump(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("<user_query>")) {
    return false;
  }
  return (
    trimmed.startsWith("<user_info>") ||
    trimmed.startsWith("<git_status>") ||
    trimmed.startsWith("<user_rules>")
  );
}

/**
 * Convert grok-build `chat_history.jsonl` objects into a seed SessionState.
 * Drops system rows and harness context dumps. Tool results are truncated.
 * @param records Parsed JSONL objects.
 * @param identity Session chrome.
 * @returns Idle SessionState with origin=seed rows.
 */
export function sessionStateFromChatHistory(
  records: unknown[],
  identity: SessionHistoryIdentity,
): SessionState {
  const timeline: TimelineItem[] = [];
  const toolCalls: Record<string, ToolCallCard> = {};
  let lastAgentText = "";
  let seq = 0;
  const nextId = (prefix: string): string => {
    seq += 1;
    return `disk_${prefix}_${seq}`;
  };

  for (const raw of records) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const rec = raw as Record<string, unknown>;
    const kind = String(rec.type ?? "");
    if (kind === "system") {
      continue;
    }
    if (kind === "user") {
      const blocks = displayUserBlocks(contentToBlocks(rec.content));
      if (blocks.length === 0) {
        continue;
      }
      timeline.push({
        kind: "user",
        id: nextId("user"),
        blocks,
        origin: "seed",
        agentConfirmed: false,
      });
      continue;
    }
    if (kind === "reasoning") {
      const text = reasoningSummaryText(rec);
      if (!text) {
        continue;
      }
      timeline.push({
        kind: "thought",
        id: nextId("thought"),
        text,
        collapsed: true,
        startedAt: 0,
        origin: "seed",
        agentConfirmed: false,
      });
      continue;
    }
    if (kind === "assistant") {
      const text = typeof rec.content === "string" ? rec.content : "";
      if (text.trim()) {
        lastAgentText = text;
        timeline.push({
          kind: "agent",
          id: nextId("agent"),
          text,
          origin: "seed",
          agentConfirmed: false,
        });
      }
      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
      for (const call of calls) {
        applyAssistantToolCall(call, timeline, toolCalls, nextId);
      }
      continue;
    }
    if (kind === "tool_result") {
      applyToolResult(rec, timeline, toolCalls, nextId);
    }
  }

  const state = createSessionState({
    id: identity.sessionId,
    workspace: identity.workspace,
    model: identity.model,
    mode: identity.mode,
  });
  state.timeline = tagSeedUserMessages(timeline);
  state.toolCalls = toolCalls;
  state.lastAgentText = lastAgentText;
  if (identity.title?.trim()) {
    state.title = identity.title.trim();
  }
  state.status = "idle";
  return state;
}

/**
 * Coerce one chat_history `content` field into ACP content blocks.
 * @param content String or block array from disk.
 */
function contentToBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (rec.type === "image" && typeof rec.mimeType === "string") {
      blocks.push({
        type: "image",
        mimeType: rec.mimeType,
        data: typeof rec.data === "string" ? rec.data : "",
      });
      continue;
    }
    if (typeof rec.text === "string") {
      blocks.push({ type: "text", text: rec.text });
    }
  }
  return blocks;
}

/**
 * Run {@link displayUserText} on text blocks and drop emptied rows.
 * @param blocks Raw user blocks.
 */
function displayUserBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "text") {
      out.push(block);
      continue;
    }
    const text = displayUserText(block.text);
    if (text) {
      out.push({ type: "text", text });
    }
  }
  return out;
}

/**
 * Join reasoning `summary[].text` into one thought body.
 * @param rec chat_history reasoning object.
 */
function reasoningSummaryText(rec: Record<string, unknown>): string {
  const summary = rec.summary;
  if (!Array.isArray(summary)) {
    return typeof rec.content === "string" ? rec.content.trim() : "";
  }
  const parts: string[] = [];
  for (const item of summary) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const text = (item as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      parts.push(text.trim());
    }
  }
  return parts.join("\n");
}

/**
 * Register one assistant.tool_calls entry as a completed tool card + pointer.
 * @param call Unknown tool_call object.
 * @param timeline Timeline being built.
 * @param toolCalls Card map being built.
 * @param nextId Stable local id factory.
 */
function applyAssistantToolCall(
  call: unknown,
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard>,
  nextId: (prefix: string) => string,
): void {
  if (!call || typeof call !== "object") {
    return;
  }
  const rec = call as Record<string, unknown>;
  const toolCallId = String(rec.id ?? rec.toolCallId ?? "").trim();
  if (!toolCallId) {
    return;
  }
  const name = String(rec.name ?? rec.title ?? "").trim();
  const rawInput = coerceToolArguments(rec.arguments ?? rec.rawInput);
  toolCalls[toolCallId] = {
    toolCallId,
    title: name || undefined,
    kind: toolKindFromName(name),
    status: "completed",
    ...(rawInput ? { rawInput } : {}),
  };
  const already = timeline.some(
    (item) => item.kind === "tool" && item.toolCallId === toolCallId,
  );
  if (!already) {
    timeline.push({
      kind: "tool",
      id: nextId("tool"),
      toolCallId,
    });
  }
}

/**
 * Attach a tool_result body onto an existing card (or create a stub).
 * @param rec chat_history tool_result object.
 * @param timeline Timeline being built.
 * @param toolCalls Card map being built.
 * @param nextId Stable local id factory.
 */
function applyToolResult(
  rec: Record<string, unknown>,
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard>,
  nextId: (prefix: string) => string,
): void {
  const toolCallId = String(rec.tool_call_id ?? rec.toolCallId ?? "").trim();
  if (!toolCallId) {
    return;
  }
  const text = truncateToolResult(stringifyToolResult(rec.content));
  const existing = toolCalls[toolCallId];
  toolCalls[toolCallId] = {
    toolCallId,
    title: existing?.title,
    kind: existing?.kind,
    status: "completed",
    rawInput: existing?.rawInput,
    content: text ? [{ type: "text", text }] : existing?.content,
  };
  const already = timeline.some(
    (item) => item.kind === "tool" && item.toolCallId === toolCallId,
  );
  if (!already) {
    timeline.push({
      kind: "tool",
      id: nextId("tool"),
      toolCallId,
    });
  }
}

/**
 * Map a grok-build tool name onto an ACP tool kind for grouping chrome.
 * @param name Tool name from chat_history (e.g. `grep`, `read_file`).
 */
function toolKindFromName(name: string): ToolCallCard["kind"] | undefined {
  const n = name.toLowerCase();
  if (!n) {
    return undefined;
  }
  if (n.includes("grep") || n.includes("search") || n.includes("glob")) {
    return "search";
  }
  if (n.includes("read") || n.includes("list_dir") || n.includes("listdir")) {
    return "read";
  }
  if (
    n.includes("write") ||
    n.includes("replace") ||
    n.includes("edit") ||
    n.includes("str_replace")
  ) {
    return "edit";
  }
  if (
    n.includes("bash") ||
    n.includes("terminal") ||
    n.includes("shell") ||
    n.includes("command")
  ) {
    return "execute";
  }
  if (n.includes("web") || n.includes("fetch") || n.includes("http")) {
    return "fetch";
  }
  return undefined;
}

/**
 * Parse tool `arguments` (JSON string or object) into a rawInput bag.
 * @param value chat_history tool_call.arguments.
 */
function coerceToolArguments(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { arguments: value };
    }
  }
  return undefined;
}

/**
 * Flatten a tool_result content field to text.
 * @param content String or unknown structured body.
 */
function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content == null) {
    return "";
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Cap a tool_result so one noisy grep cannot bloat the hydrate snapshot.
 * @param text Full tool result.
 */
function truncateToolResult(text: string): string {
  if (text.length <= DISK_TOOL_RESULT_MAX) {
    return text;
  }
  return `${text.slice(0, DISK_TOOL_RESULT_MAX)}\n…`;
}
