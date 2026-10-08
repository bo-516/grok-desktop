/**
 * Compose the "Send to agent" prompt from review comments. Pure: the text is
 * sent through the normal composer send path (queued while a turn streams).
 */

import { formatCommentLocation, type ReviewComment } from "./reviewComments";

/** First line of every review prompt (also used to recognise one in tests). */
export const REVIEW_PROMPT_INTRO =
  "Please address these review comments on the current changes. Each one names a file location, quotes the diff lines it refers to, and says what to change.";

/**
 * Backtick fence one longer than the longest backtick run in the content
 * (minimum three), so quoted code that itself contains fences stays intact.
 * @param lines Content lines.
 * @returns Fence string.
 */
export function fenceFor(lines: readonly string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longest = Math.max(longest, run.length);
    }
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Render one comment as a numbered block: location, fenced diff excerpt,
 * then the comment text (indented under the number).
 * @param c Comment.
 * @param n 1-based position in the prompt.
 * @returns Markdown block.
 */
export function formatReviewComment(c: ReviewComment, n: number): string {
  const excerpt = c.excerpt.map((l) => `${l.mark} ${l.text}`);
  if (c.excerptOmitted > 0) {
    excerpt.push(`  … (${c.excerptOmitted} more line${c.excerptOmitted === 1 ? "" : "s"})`);
  }
  const fence = fenceFor(excerpt);
  const body = c.body.split("\n").map((l) => `   ${l}`.trimEnd());
  return [
    `${n}. ${formatCommentLocation(c)}`,
    `   ${fence}diff`,
    ...excerpt.map((l) => `   ${l}`.trimEnd()),
    `   ${fence}`,
    ...body,
  ].join("\n");
}

/**
 * Whole prompt for a non-empty comment list, in the order given.
 * @param comments Comments to send (empty → "").
 * @returns Prompt text, or "" when there is nothing to send.
 */
export function formatReviewPrompt(comments: readonly ReviewComment[]): string {
  if (comments.length === 0) {
    return "";
  }
  return [REVIEW_PROMPT_INTRO, ...comments.map((c, i) => formatReviewComment(c, i + 1))].join("\n\n");
}
