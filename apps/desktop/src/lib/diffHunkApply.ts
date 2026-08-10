/**
 * Per-hunk accept/reject for native diff review (F-NATIVE-06).
 * Pure: builds resulting file text from jsdiff chunks so trailing newlines
 * and CRLF are preserved byte-for-byte (no split/join on "\n").
 */

import { diffLines } from "diff";
import { DIFF_MAX_EDIT_LENGTH } from "./diffCore";
import { buildLineDiff, type DiffLine } from "./diffReview";

export type HunkDecision = "pending" | "accept" | "reject";

export type ReviewableHunk = {
  /** Stable id for UI. */
  id: string;
  /** Contiguous change lines (add/del) plus optional context. */
  lines: DiffLine[];
  decision: HunkDecision;
};

/**
 * Split a full line-diff into reviewable hunks (contiguous non-same runs).
 * Same lines between change runs become separate context (not interactive).
 * @param lines Full diff lines from buildLineDiff.
 * @returns Ordered reviewable hunks with pending decisions.
 */
export function splitIntoHunks(lines: DiffLine[]): ReviewableHunk[] {
  const hunks: ReviewableHunk[] = [];
  let buf: DiffLine[] = [];
  let idx = 0;
  const flush = () => {
    if (buf.length === 0) {
      return;
    }
    hunks.push({
      id: `hunk-${idx++}`,
      lines: buf,
      decision: "pending",
    });
    buf = [];
  };
  for (const line of lines) {
    if (line.type === "same") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return hunks;
}

/**
 * Apply hunk decisions to produce the final file text.
 * Uses jsdiff `diffLines` chunks (values already include `\n`) so trailing
 * newline presence/absence is preserved byte-for-byte.
 * - accept / pending: take new side (added chunks)
 * - reject: keep old side (removed chunks)
 * Context (unchanged) chunks always kept.
 * @param oldText Original file content before agent edit.
 * @param newText Agent-proposed content.
 * @param hunks Decisions for each change run (must match splitIntoHunks order).
 * @returns Merged file text.
 */
export function applyHunkDecisions(
  oldText: string | undefined | null,
  newText: string | undefined | null,
  hunks: ReviewableHunk[],
): string {
  const old = oldText == null ? "" : String(oldText);
  const next = newText == null ? "" : String(newText);
  if (old === next) {
    return next;
  }

  const changes = diffLines(old, next, {
    maxEditLength: DIFF_MAX_EDIT_LENGTH,
  });

  // When the engine bails, honor all-reject vs otherwise new text.
  if (changes == null) {
    const allReject =
      hunks.length > 0 && hunks.every((h) => h.decision === "reject");
    return allReject ? old : next;
  }

  let hunkCursor = 0;
  let out = "";
  let i = 0;
  while (i < changes.length) {
    const chunk = changes[i];
    if (chunk === undefined) {
      break;
    }
    if (!chunk.added && !chunk.removed) {
      out += chunk.value;
      i += 1;
      continue;
    }
    // Contiguous added/removed run = one reviewable hunk.
    const run: typeof changes = [];
    while (i < changes.length) {
      const cur = changes[i];
      if (cur === undefined || (!cur.added && !cur.removed)) {
        break;
      }
      run.push(cur);
      i += 1;
    }
    const decision = hunks[hunkCursor]?.decision ?? "accept";
    hunkCursor += 1;
    if (decision === "reject") {
      for (const part of run) {
        if (part.removed) {
          out += part.value;
        }
      }
    } else {
      for (const part of run) {
        if (part.added) {
          out += part.value;
        }
      }
    }
  }
  return out;
}

/**
 * Build review state from old/new text.
 * @param oldText Prior content.
 * @param newText Proposed content.
 * @returns Hunks + summary string.
 */
export function createDiffReview(
  oldText: string | undefined | null,
  newText: string | undefined | null,
): { hunks: ReviewableHunk[]; summary: string } {
  const diff = buildLineDiff(oldText, newText);
  return {
    hunks: splitIntoHunks(diff.lines),
    summary: diff.summary,
  };
}

/**
 * Set decision on one hunk immutably.
 * @param hunks Current hunk list.
 * @param hunkId Target id.
 * @param decision New decision.
 * @returns New array with the one hunk updated.
 */
export function setHunkDecision(
  hunks: ReviewableHunk[],
  hunkId: string,
  decision: HunkDecision,
): ReviewableHunk[] {
  return hunks.map((h) => (h.id === hunkId ? { ...h, decision } : h));
}
