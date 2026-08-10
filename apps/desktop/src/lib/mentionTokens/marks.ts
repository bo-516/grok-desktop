/**
 * Mention mark constants, segment types, and trigger helpers.
 * Shared by the composer draft (zero-width marks) and timeline history chips
 * (visible `@` / `/`). Pure — no DOM, store, or bridge access.
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
      /**
       * Picked from the completion menu (zero-width trigger) rather than typed.
       * Only committed tokens point at something the workspace scan confirmed,
       * so only they earn chip treatment and atomic caret/delete behavior.
       */
      committed: boolean;
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
