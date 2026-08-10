/**
 * Public barrel for `@file` / `/command` mention tokens.
 * Keeps `@/lib/mentionTokens` and relative `./mentionTokens` imports stable
 * after the parse / caret / marks split.
 */

export {
  isVisibleMentionTrigger,
  materializeMentionTriggers,
  mentionDisplayLabel,
  mentionKindClass,
  mentionMarkForSymbol,
  mentionTriggerSymbol,
  MENTION_AT_MARK,
  MENTION_SLASH_MARK,
  splitMentionTrigger,
  type MentionKind,
  type MentionSegment,
} from "./marks";

export { hasMentionTokens, splitMentionTokens } from "./parse";

export {
  caretJumpOverMention,
  deleteMentionUnit,
  mentionUnitForBackspace,
  mentionUnitForDelete,
  snapCaretToMentionEdge,
  type MentionUnitRange,
} from "./caret";
