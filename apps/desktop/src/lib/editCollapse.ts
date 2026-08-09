/**
 * Collapse edit tool cards to +N/-M summaries (F-TOOL-07).
 */

import { buildLineDiff } from "./diffReview";

/**
 * Summarize an edit diff as +added/-removed.
 * @param oldText Previous content.
 * @param newText New content.
 */
export function editDiffSummary(
  oldText: string | undefined | null,
  newText: string | undefined | null,
): string {
  const h = buildLineDiff(oldText, newText);
  return h.summary;
}
