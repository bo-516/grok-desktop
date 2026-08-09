/**
 * Shared parser for `@file` / `/command` tokens.
 *
 * Single source of truth for both mention surfaces: the composer mirror layer
 * (live draft) and the timeline history bubble (already-sent text). Keeping one
 * parser is what stops the two views from classifying the same token differently
 * (e.g. a path highlighted while typing but plain once sent).
 *
 * Pure text in, segment model out — no DOM, store, or bridge access.
 *
 * Composer draft nuance: completed tokens may use zero-width marks instead of
 * visible `@` / `/` so the mirror can hide the trigger without leaving a gap
 * (transparent `@` still occupies advance width). Marks materialize back to
 * `@` / `/` only when sending to the agent.
 */

/** How a token is classified for icon + tint selection. */
export type MentionKind = "file" | "directory" | "command";

/**
 * Zero-width stand-in for `@` in the composer draft after a token is committed.
 * Same string length as `@` so caret indices stay stable when sealing.
 */
export const MENTION_AT_MARK = "\u2060";

/**
 * Zero-width stand-in for `/` in the composer draft after a token is committed.
 * Same string length as `/` so caret indices stay stable when sealing.
 */
export const MENTION_SLASH_MARK = "\u2061";

/**
 * One highlighted token segment inside a draft or a sent message.
 * `offset` is the segment's start index in the source string: unique and stable
 * across re-parses, so React keys never collide when the same token repeats.
 */
export type MentionSegment =
  | { type: "text"; text: string; offset: number }
  | {
      type: "mention";
      /** Full token as stored, e.g. `@src/App.tsx`, mark+path, or `/review`. */
      text: string;
      offset: number;
      kind: MentionKind;
      /** Leading `@` / `/` or the zero-width mark used in the composer draft. */
      trigger: string;
      /** Remainder after the trigger (path or command name). */
      body: string;
    };

/**
 * Whether a trigger character is a visible `@` or `/` (still typing / unsealed).
 * @param trigger First character of a mention token.
 * @returns true when the glyph has advance width and should paint in the mirror.
 */
export function isVisibleMentionTrigger(trigger: string): boolean {
  return trigger === "@" || trigger === "/";
}

/**
 * Map a stored trigger char to the agent-facing symbol.
 * @param trigger Visible `@`/`/` or a zero-width composer mark.
 * @returns `@` for file marks, `/` for command marks; empty when unknown.
 */
export function mentionTriggerSymbol(trigger: string): "@" | "/" | "" {
  if (trigger === "@" || trigger === MENTION_AT_MARK) {
    return "@";
  }
  if (trigger === "/" || trigger === MENTION_SLASH_MARK) {
    return "/";
  }
  return "";
}

/**
 * Zero-width mark matching an agent-facing completion symbol.
 * @param symbol `@` for files or `/` for commands.
 * @returns Mark to store in the draft so the trigger occupies no layout width.
 */
export function mentionMarkForSymbol(symbol: "@" | "/"): string {
  return symbol === "@" ? MENTION_AT_MARK : MENTION_SLASH_MARK;
}

/**
 * Split a completed mention token into trigger + body for chip rendering.
 * @param text Full token including leading `@`, `/`, or a zero-width mark.
 * @returns Trigger character(s) and visible body; body is the whole input and
 *   trigger is empty when the text does not start with a known trigger, so
 *   callers never render a chip with a missing label.
 */
export function splitMentionTrigger(text: string): {
  trigger: string;
  body: string;
} {
  if (
    text.startsWith("@") ||
    text.startsWith("/") ||
    text.startsWith(MENTION_AT_MARK) ||
    text.startsWith(MENTION_SLASH_MARK)
  ) {
    return { trigger: text.slice(0, 1), body: text.slice(1) };
  }
  return { trigger: "", body: text };
}

/**
 * Strip surrounding quotes from a mention path so chips show the bare path.
 * @param body Token body, possibly `"design docs/brief.md"` for paths with spaces.
 * @returns Display path without the quoting that only matters to the agent.
 */
export function mentionDisplayLabel(body: string): string {
  return body.replace(/^"|"$/g, "");
}

/**
 * Split text into plain runs and mention-like tokens for chip rendering.
 * Mentions: `@path` or mark+path (not email-like). Commands: `/name` or mark+name.
 * @param text Full composer draft or sent message; empty input yields a single
 *   empty text segment so callers can map without a length check.
 * @returns Segments in source order; concatenating `text` restores the input exactly.
 */
export function splitMentionTokens(text: string): MentionSegment[] {
  if (!text) {
    return [{ type: "text", text: "", offset: 0 }];
  }

  const segments: MentionSegment[] = [];
  /**
   * Token-boundary @path / /cmd, including zero-width composer marks.
   * Paths may include / . - _ and optional double-quoted spans for spaces.
   */
  const re = new RegExp(
    `(?:^|[\\s([{])(${MENTION_AT_MARK}(?:"[^"]*"|[^\\s]+)|${MENTION_SLASH_MARK}[a-zA-Z][\\w-]*|@(?:"[^"]*"|[^\\s]+)|\\/[a-zA-Z][\\w-]*)`,
    "g",
  );
  let last = 0;
  let match = re.exec(text);
  while (match) {
    const full = match[0];
    const token = match[1] ?? "";
    const leadLen = full.length - token.length;
    const tokenStart = match.index + leadLen;

    if (tokenStart > last) {
      segments.push({
        type: "text",
        text: text.slice(last, tokenStart),
        offset: last,
      });
    }

    const first = token[0] ?? "";
    if (first === "@" || first === MENTION_AT_MARK) {
      const before = tokenStart > 0 ? text[tokenStart - 1] ?? "" : "";
      // Skip email-like user@host when the char before @ is alnum (visible @ only).
      if (
        first === "@" &&
        tokenStart > 0 &&
        /[a-z0-9._%+-]/i.test(before)
      ) {
        segments.push({ type: "text", text: token, offset: tokenStart });
      } else {
        const { trigger, body } = splitMentionTrigger(token);
        const path = mentionDisplayLabel(body);
        const isDir = path.endsWith("/") || !path.includes(".");
        segments.push({
          type: "mention",
          text: token,
          offset: tokenStart,
          kind: isDir ? "directory" : "file",
          trigger,
          body,
        });
      }
    } else {
      const { trigger, body } = splitMentionTrigger(token);
      segments.push({
        type: "mention",
        text: token,
        offset: tokenStart,
        kind: "command",
        trigger,
        body,
      });
    }

    last = tokenStart + token.length;
    match = re.exec(text);
  }

  if (last < text.length) {
    segments.push({ type: "text", text: text.slice(last), offset: last });
  }
  return segments.length > 0
    ? segments
    : [{ type: "text", text, offset: 0 }];
}

/**
 * Whether a string contains at least one renderable mention token.
 * @param text Message or draft text.
 * @returns true when chip rendering would change the output; false lets callers
 *   keep a cheap plain-text path for ordinary messages.
 */
export function hasMentionTokens(text: string): boolean {
  return splitMentionTokens(text).some((segment) => segment.type === "mention");
}

/**
 * Map a mention kind to the tint class shared by the mirror layer and chips.
 * @param kind Token classification from splitMentionTokens.
 * @returns Class name whose colors resolve through defineColor mention tokens.
 */
export function mentionKindClass(kind: MentionKind): string {
  if (kind === "directory") {
    return "mention-dir";
  }
  if (kind === "command") {
    return "mention-command";
  }
  return "mention-file";
}

/**
 * Expand zero-width composer marks to agent-facing `@` / `/` before send.
 * Visible triggers pass through unchanged. Length is preserved so callers that
 * only need the wire string do not recompute carets.
 * @param text Composer draft that may contain marks.
 * @returns Text the agent should receive (real `@file` / `/command` syntax).
 */
export function materializeMentionTriggers(text: string): string {
  return text
    .replaceAll(MENTION_AT_MARK, "@")
    .replaceAll(MENTION_SLASH_MARK, "/");
}

/**
 * Seal completed visible triggers into zero-width marks so the mirror can hide
 * them without leaving an advance-width hole between neighboring tokens.
 * A token is sealed only when followed by whitespace and the caret is not
 * inside it (still editing). Length stays the same; caret index is unchanged.
 * @param text Current draft.
 * @param caret Caret index; tokens containing this caret are left unsealed.
 * @returns Draft with completed triggers marked; same caret.
 */
export function sealCompletedMentions(
  text: string,
  caret: number,
): { value: string; caret: number } {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const segments = splitMentionTokens(text);
  let out = "";

  for (const seg of segments) {
    if (seg.type === "text") {
      out += seg.text;
      continue;
    }

    const end = seg.offset + seg.text.length;
    const after = text[end] ?? "";
    const followedByWhitespace = after.length > 0 && /\s/.test(after);
    const caretInside = safeCaret > seg.offset && safeCaret < end;
    const canSeal =
      followedByWhitespace &&
      !caretInside &&
      isVisibleMentionTrigger(seg.trigger);

    if (canSeal) {
      const mark =
        seg.trigger === "@" ? MENTION_AT_MARK : MENTION_SLASH_MARK;
      out += `${mark}${seg.body}`;
    } else {
      out += seg.text;
    }
  }

  return { value: out, caret: safeCaret };
}

/**
 * Inclusive range of a mention unit for atomic editing.
 * @param start Token start index in the source string.
 * @param end Exclusive end index of the token (not including trailing space).
 */
export type MentionUnitRange = { start: number; end: number };

/**
 * Find the mention that owns the caret for Backspace (inside or just after).
 * @param text Draft text.
 * @param caret Collapsed caret index.
 * @returns Token range, or null when Backspace should delete one normal char.
 */
export function mentionUnitForBackspace(
  text: string,
  caret: number,
): MentionUnitRange | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention") {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret > start && safeCaret <= end) {
      return { start, end };
    }
  }
  return null;
}

/**
 * Find the mention that owns the caret for Delete (inside or at start).
 * @param text Draft text.
 * @param caret Collapsed caret index.
 * @returns Token range, or null when Delete should remove one normal char.
 */
export function mentionUnitForDelete(
  text: string,
  caret: number,
): MentionUnitRange | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention") {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret >= start && safeCaret < end) {
      return { start, end };
    }
  }
  return null;
}

/**
 * Delete a mention unit as a single chunk and place the caret at the hole.
 * @param text Draft text.
 * @param range Unit from mentionUnitForBackspace / mentionUnitForDelete.
 * @returns New draft and caret at `range.start`.
 */
export function deleteMentionUnit(
  text: string,
  range: MentionUnitRange,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  return {
    value: `${text.slice(0, start)}${text.slice(end)}`,
    caret: start,
  };
}

/**
 * Snap a caret that sits inside a mention to the nearer edge so partial
 * in-token editing is not offered (tokens are atomic once committed).
 * @param text Draft text.
 * @param caret Proposed caret index.
 * @returns Edge index when inside a mention; otherwise the original caret.
 */
export function snapCaretToMentionEdge(text: string, caret: number): number {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention") {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret > start && safeCaret < end) {
      const toStart = safeCaret - start;
      const toEnd = end - safeCaret;
      return toStart <= toEnd ? start : end;
    }
  }
  return safeCaret;
}
