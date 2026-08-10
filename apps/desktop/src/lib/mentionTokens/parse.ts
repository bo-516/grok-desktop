/**
 * Mention token parser: split drafts/messages into plain runs and chips.
 * Single source of truth for composer mirror and timeline history bubbles.
 * Pure text in, segment model out — no DOM, store, or bridge access.
 */

import {
  isVisibleMentionTrigger,
  mentionDisplayLabel,
  MENTION_AT_MARK,
  MENTION_SLASH_MARK,
  splitMentionTrigger,
  type MentionSegment,
} from "./marks";

/**
 * Sentence punctuation the greedy body pattern swallows off the end of a token.
 * `@src/App.tsx,` is a mention plus a comma — not a file named `App.tsx,`.
 */
const MENTION_TAIL_PUNCT = /[.,;:!?)\]}'"`]+$/;

/**
 * Shorten a matched token to the part that is actually the mention.
 * Quoted bodies (`@"design docs/brief.md"`) are left alone — their closing
 * quote belongs to the token. The trimmed characters are not dropped: the
 * caller resumes plain-text emission at the shortened end, so concatenating
 * every segment still reproduces the source string exactly.
 * @param token Full regex match including the trigger character.
 * @returns Token without trailing sentence punctuation; may equal the input.
 */
function trimMentionTail(token: string): string {
  const { trigger, body } = splitMentionTrigger(token);
  if (body.startsWith('"')) {
    return token;
  }
  const trimmed = body.replace(MENTION_TAIL_PUNCT, "");
  return trimmed ? `${trigger}${trimmed}` : token;
}

/**
 * Whether a visible `/name` token is really a slash command.
 *
 * Only the leading token of a message can be one, so anything further in is a
 * filesystem path (`/Users/...`, `/tmp`, `/dev/null`) or part of a quoted
 * shell line — accenting those was dressing up log text as commands. Committed
 * tokens skip this check entirely: the completion menu already proved them.
 * @param text Full source string.
 * @param tokenStart Index of the `/`.
 * @param tokenEnd Exclusive end index of the token.
 * @returns true when the token may render as a command.
 */
function isLeadingCommand(
  text: string,
  tokenStart: number,
  tokenEnd: number,
): boolean {
  if (tokenStart !== text.length - text.trimStart().length) {
    return false;
  }
  // `/Users/shaoboli` opens like a command but continues as a path.
  return text[tokenEnd] !== "/";
}

/**
 * Whether a visible `@body` token looks like a workspace file reference.
 * Completion only ever inserts workspace-relative paths, so a leading `/`
 * marks an absolute path that no picker produced — plain text is the honest
 * rendering. Committed tokens bypass this.
 * @param body Token body after the trigger.
 * @returns true when the token may render as a file / directory mention.
 */
function isWorkspaceMentionBody(body: string): boolean {
  return body.length > 0 && !body.startsWith("/");
}

/**
 * Split text into plain runs and mention-like tokens for chip rendering.
 * Mentions: `@path` or mark+path (not email-like, not absolute). Commands:
 * mark+name anywhere, or a visible `/name` that leads the message.
 *
 * Visible triggers are guesses (freely typed, or a committed token whose mark
 * was materialized on send) and are held to the stricter grammar above, so
 * pasted shell lines and log output stop lighting up as mentions. Zero-width
 * marks are proof of a menu pick and always classify.
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
    const raw = match[1] ?? "";
    const leadLen = full.length - raw.length;
    const tokenStart = match.index + leadLen;
    const first = raw[0] ?? "";
    const committed = !isVisibleMentionTrigger(first);
    const token = committed ? raw : trimMentionTail(raw);
    const tokenEnd = tokenStart + token.length;

    if (tokenStart > last) {
      segments.push({
        type: "text",
        text: text.slice(last, tokenStart),
        offset: last,
      });
    }

    const { trigger, body } = splitMentionTrigger(token);
    if (first === "@" || first === MENTION_AT_MARK) {
      const before = tokenStart > 0 ? text[tokenStart - 1] ?? "" : "";
      // Skip email-like user@host when the char before @ is alnum (visible @ only).
      const emailLike =
        first === "@" && tokenStart > 0 && /[a-z0-9._%+-]/i.test(before);
      if (!committed && (emailLike || !isWorkspaceMentionBody(body))) {
        segments.push({ type: "text", text: token, offset: tokenStart });
      } else {
        const path = mentionDisplayLabel(body);
        const isDir = path.endsWith("/") || !path.includes(".");
        segments.push({
          type: "mention",
          text: token,
          offset: tokenStart,
          kind: isDir ? "directory" : "file",
          trigger,
          body,
          committed,
        });
      }
    } else if (!committed && !isLeadingCommand(text, tokenStart, tokenEnd)) {
      segments.push({ type: "text", text: token, offset: tokenStart });
    } else {
      segments.push({
        type: "mention",
        text: token,
        offset: tokenStart,
        kind: "command",
        trigger,
        body,
        committed,
      });
    }

    last = tokenEnd;
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
