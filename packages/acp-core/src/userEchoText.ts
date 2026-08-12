/**
 * Sanitizers for agent-echoed user text (`user_message_chunk`).
 *
 * grok-build replays a prompt as the *agent* received it, not as the person
 * typed it, and several rewrites leak into the canvas if left alone:
 *
 * 1. Harness `<system-reminder>` notices (background-task completions, hook
 *    output) arrive as their own user chunks flagged `_meta.hideFromScrollback`.
 *    Rendering them turns the user bubble into a log dump.
 * 2. Goal mode injects a long system-reminder that only contains
 *    `A goal has been set: <objective>` — stripping it leaves an empty canvas
 *    with no user intent. We keep a short `Goal: …` line instead.
 * 3. Subagent / harness role cards (`You are an **adversarial verifier**…`
 *    plus multi-page Inputs / Output contract) arrive as a single user chunk
 *    with no hide flag. Dumping 30KB of system prompt as the "user" bubble is
 *    wrong; we collapse them to a short intent line (role · objective).
 * 4. Attached images come back as `[Image #N]` placeholders. Comparing the raw
 *    echo against the local body then fails, so the optimistic row never
 *    confirms and the next replay appends a duplicate bubble.
 *
 * Pure string helpers — no state, no I/O, no DOM. Used by the timeline reducer
 * before an echo may be stored, and by seed tagging to heal caches written
 * before this filter existed.
 */

import type { SessionUpdate } from "./types.js";

/** Complete `<system-reminder>…</system-reminder>` block, including newlines. */
const REMINDER_SPAN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Orphan close tag: chunk started inside a reminder, so drop everything up to it. */
const REMINDER_CLOSE_HEAD = /^[\s\S]*?<\/system-reminder>/;

/** Unterminated open tag: reminder ran past the end of this chunk. */
const REMINDER_OPEN_TAIL = /<system-reminder>[\s\S]*$/;

/** Goal harness injection line inside a system-reminder (or plain text). */
const GOAL_SET_LINE = /A goal has been set:\s*(.+)/i;

/** Role-card openers used by harness subagent / skeptic / planner prompts. */
const ROLE_OPENER = /^You are (?:an?|the)\s+/i;

/**
 * Filled `OBJECTIVE:` value lines. Template copy ("the user's goal, verbatim.")
 * is filtered out later; real goals are paths / short imperatives.
 */
const OBJECTIVE_LINE = /^OBJECTIVE:\s*(.+?)\s*$/gim;

/** `OBJECTIVE:\n@docs/...` block form used by goal skeptic task packs. */
const OBJECTIVE_BLOCK = /^OBJECTIVE:\s*\n([^\n]+)/gim;

/** Agent stand-in for an image ContentBlock in the echoed prompt. */
export const IMAGE_PLACEHOLDER = /\[Image\s*#\d+\]/gi;

/**
 * Minimum length before a role-card heuristic may fire.
 * Ordinary chat prompts stay well under this; harness packs are multi-KB.
 */
const HARNESS_ROLE_MIN_LEN = 1500;

/**
 * Count `[Image #N]` placeholders in agent-echoed user text.
 * Used when history only has the placeholder and no binary image block.
 * @param text User bubble body that may contain image stand-ins.
 * @returns Number of placeholders (0 when none).
 */
export function countImagePlaceholders(text: string): number {
  if (!text) {
    return 0;
  }
  const matches = text.match(IMAGE_PLACEHOLDER);
  return matches?.length ?? 0;
}

/**
 * Remove `[Image #N]` stand-ins for display or title extraction.
 * Collapses leftover whitespace so the bubble does not keep a gap where the
 * thumbnail already shows the attachment.
 * @param text Raw user text (may include placeholders).
 * @returns Text with placeholders stripped; may be empty.
 */
export function stripImagePlaceholders(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .replace(IMAGE_PLACEHOLDER, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Read a nested `_meta` record without asserting the whole update shape.
 * @param value Update or content object that may carry `_meta`.
 * @returns The `_meta` record, or null when absent / not an object.
 */
function metaOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const meta = (value as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }
  return meta as Record<string, unknown>;
}

/**
 * Whether the agent itself marked this update as not-for-transcript.
 * grok-build sets `_meta.hideFromScrollback` on injected reminder chunks; it is
 * the authoritative signal, so honoring it is cheaper and safer than guessing
 * from the text. Checked on the update and on its content (agents differ on
 * which level carries the flag); a missing flag means "show it".
 * @param update Session update already extracted by extractSessionUpdate.
 * @returns true when the chunk must never reach the timeline.
 */
export function isHiddenFromScrollback(update: SessionUpdate): boolean {
  const own = metaOf(update);
  if (own?.hideFromScrollback === true) {
    return true;
  }
  const content = metaOf((update as { content?: unknown }).content);
  return content?.hideFromScrollback === true;
}

/**
 * Remove harness `<system-reminder>` blocks from echoed user text.
 * Handles complete blocks plus the two split-chunk shapes (leading orphan close
 * tag, trailing unterminated open tag) so a reminder that straddles a chunk
 * boundary cannot leave half a log in the bubble. Blank runs left behind are
 * collapsed and the result trimmed.
 * @param text Raw chunk text or a cached user block body.
 * @returns Text with reminders removed; empty string when the input was only
 *   reminder content, which callers must treat as "drop this chunk".
 */
export function stripSystemReminders(text: string): string {
  if (!text.includes("system-reminder")) {
    return text;
  }
  return text
    .replace(REMINDER_SPAN, "")
    .replace(REMINDER_CLOSE_HEAD, "")
    .replace(REMINDER_OPEN_TAIL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * First line of a multi-line capture, trimmed.
 * @param raw Match group that may include trailing prose.
 * @returns First non-empty line, or empty string.
 */
function firstLine(raw: string): string {
  const line = raw.split(/\r?\n/, 1)[0] ?? "";
  return line.trim();
}

/**
 * Whether an OBJECTIVE value is harness template copy rather than a real goal.
 * @param value Candidate objective string.
 * @returns true when the value must be ignored.
 */
function isObjectivePlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) {
    return true;
  }
  if (/^the user's goal/i.test(v)) {
    return true;
  }
  if (/verbatim/i.test(v) && v.length < 48) {
    return true;
  }
  if (/^\((unavailable|none)\)/i.test(v)) {
    return true;
  }
  return false;
}

/**
 * Short intent line from a goal-mode harness injection.
 * Matches `A goal has been set: <objective>` even when wrapped in a
 * system-reminder so the canvas can show intent after reminders are stripped.
 * @param text Raw user_message_chunk body.
 * @returns `Goal: <objective>` or null when the phrase is absent.
 */
export function extractGoalIntentLine(text: string): string | null {
  if (!text.includes("goal has been set")) {
    return null;
  }
  const match = text.match(GOAL_SET_LINE);
  const objective = match?.[1] ? firstLine(match[1]) : "";
  if (!objective) {
    return null;
  }
  return `Goal: ${objective}`;
}

/**
 * Last non-placeholder OBJECTIVE value in a harness task pack.
 * Goal skeptic prompts list the field in the template first, then fill the
 * real objective later; taking the last real value avoids the template line.
 * @param text Full harness role / task prompt.
 * @returns Objective string, or null when none look real.
 */
function extractFilledObjective(text: string): string | null {
  let last: string | null = null;
  for (const match of text.matchAll(OBJECTIVE_LINE)) {
    const value = (match[1] ?? "").trim();
    if (!isObjectivePlaceholder(value)) {
      last = value;
    }
  }
  for (const match of text.matchAll(OBJECTIVE_BLOCK)) {
    const value = (match[1] ?? "").trim();
    if (!isObjectivePlaceholder(value)) {
      last = value;
    }
  }
  return last;
}

/**
 * Role title from a `You are an **…**` / `You are a …` opener.
 * @param text Full harness role prompt.
 * @returns Short role label, or null when the opener is missing.
 */
function roleTitleFromOpener(text: string): string | null {
  const head = text.trimStart();
  const bold = head.match(/^You are (?:an?|the)\s+\*\*([^*]+)\*\*/i);
  if (bold?.[1]) {
    return bold[1].trim();
  }
  const plain = head.match(/^You are (?:an?|the)\s+([^.!\n*]{3,80})/i);
  if (plain?.[1]) {
    return plain[1]
      .trim()
      .replace(/\s+for\s+the\s*$/i, "")
      .trim();
  }
  return null;
}

/**
 * High-precision detector for multi-page harness role / task cards.
 * Ordinary user chat never starts with a long "You are …" pack that also
 * carries Inputs + PLAN_FILE / CHANGED_FILES / FINAL_RESPONSE sections.
 * @param text Candidate user_message_chunk body.
 * @returns true when the text should be collapsed, not shown in full.
 */
export function looksLikeHarnessRolePrompt(text: string): boolean {
  if (text.length < HARNESS_ROLE_MIN_LEN) {
    return false;
  }
  if (!ROLE_OPENER.test(text.trimStart())) {
    return false;
  }
  const hasInputsSection =
    text.includes("## Inputs") ||
    text.includes("OBJECTIVE:") ||
    text.includes("OBJECTIVES");
  const hasContractSection =
    text.includes("PLAN_FILE") ||
    text.includes("CHANGED_FILES") ||
    text.includes("FINAL_RESPONSE") ||
    text.includes("Output contract");
  return hasInputsSection && hasContractSection;
}

/**
 * Collapse a harness role / skeptic / planner task pack to a short intent line.
 * Prefer `role · objective` when both are recoverable; fall back to either alone.
 * @param text Full harness prompt body.
 * @returns Short display string, or null when the text is not a role pack
 *   (caller must leave ordinary chat unchanged).
 */
export function summarizeHarnessRolePrompt(text: string): string | null {
  if (!looksLikeHarnessRolePrompt(text)) {
    return null;
  }
  const objective = extractFilledObjective(text);
  const role = roleTitleFromOpener(text);
  if (objective && role) {
    return `${role} · ${objective}`;
  }
  if (objective) {
    return `Goal: ${objective}`;
  }
  if (role) {
    return role;
  }
  const first = firstLine(text.trim());
  if (!first) {
    return null;
  }
  if (first.length > 120) {
    return `${first.slice(0, 117)}…`;
  }
  return first;
}

/**
 * Display form of an agent-echoed user body for the timeline bubble.
 *
 * Order:
 * 1. Goal injection → keep `Goal: <objective>` when the rest is harness noise.
 * 2. Multi-page harness role pack → short role · objective (or either alone).
 * 3. Otherwise strip system-reminders and return the remainder.
 *
 * Empty result means "drop this chunk" (no bubble). Never returns the full
 * goal system-reminder or a multi-KB role card.
 * @param text Raw `user_message_chunk` content text.
 * @returns Sanitized body to store / render; may be empty.
 */
export function sanitizeUserEchoText(text: string): string {
  if (!text) {
    return "";
  }
  const goalLine = extractGoalIntentLine(text);
  if (goalLine) {
    // Pure goal injection (reminder-only) → short intent. If human text is
    // also present outside the reminder, prefer that and drop the harness wrap.
    const withoutReminders = stripSystemReminders(text);
    if (!withoutReminders) {
      return goalLine;
    }
    // Goal phrase sometimes sits outside a reminder; if stripping left the
    // long harness prose, still prefer the short intent line.
    if (withoutReminders.includes("A goal has been set")) {
      return goalLine;
    }
    if (looksLikeHarnessRolePrompt(withoutReminders)) {
      return goalLine;
    }
    return withoutReminders;
  }
  const harnessSummary = summarizeHarnessRolePrompt(text);
  if (harnessSummary !== null) {
    return harnessSummary;
  }
  return stripSystemReminders(text);
}

/**
 * Comparison form of a user body: agent rewrites removed, whitespace flattened.
 *
 * Only ever used to decide whether an echo *is* the local text — never stored
 * and never rendered, so flattening here cannot alter what the person sees.
 * Without it, `[Image #1]` and a reflowed space make an identical message look
 * like a new one, which is what duplicated the bubble.
 * @param text Local body, accumulated echo, or an incoming chunk.
 * @returns Normalized body for prefix / equality checks.
 */
export function normalizeEchoBody(text: string): string {
  // Sanitize first so a full harness pack and its short intent line compare
  // equal after seed heal + replay.
  return stripImagePlaceholders(sanitizeUserEchoText(text))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether an echo chunk is just a replay of a body already on the canvas.
 * Prefix-tolerant in both directions so partial replays (agent still streaming)
 * and padded replays both count as "already shown".
 * @param echo Incoming chunk text.
 * @param body Text of the user row it might belong to.
 * @returns true when the chunk adds nothing new and must be discarded.
 */
export function echoRepeatsBody(echo: string, body: string): boolean {
  const a = normalizeEchoBody(echo);
  const b = normalizeEchoBody(body);
  if (!a) {
    return true;
  }
  return a === b || b.startsWith(a) || a.startsWith(b);
}
