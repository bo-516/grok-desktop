/**
 * Per-hunk accept/reject for native diff review (F-NATIVE-06).
 * Pure: builds resulting file text from line decisions; bridge writes to disk.
 */

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
 * - accept: take new side (skip del, keep add)
 * - reject: keep old side (keep del text as content, skip add)
 * - pending: treated as accept (agent already wrote new file by default)
 * Context (same) lines always kept.
 * @param oldText Original file content before agent edit.
 * @param newText Agent-proposed content.
 * @param hunks Decisions for each change run (must match splitIntoHunks order).
 */
export function applyHunkDecisions(
  oldText: string | undefined | null,
  newText: string | undefined | null,
  hunks: ReviewableHunk[],
): string {
  const full = buildLineDiff(oldText, newText);
  const decisions = new Map(hunks.map((h) => [h.id, h.decision]));
  // Re-split to align ids with current algorithm
  const currentHunks = splitIntoHunks(full.lines);
  let hunkCursor = 0;
  const out: string[] = [];

  let i = 0;
  while (i < full.lines.length) {
    const line = full.lines[i]!;
    if (line.type === "same") {
      out.push(line.text);
      i += 1;
      continue;
    }
    // Consume a change run
    const run: DiffLine[] = [];
    while (i < full.lines.length && full.lines[i]!.type !== "same") {
      run.push(full.lines[i]!);
      i += 1;
    }
    const hunkMeta = currentHunks[hunkCursor++];
    const decision =
      (hunkMeta && decisions.get(hunkMeta.id)) || hunkMeta?.decision || "accept";
    if (decision === "reject") {
      for (const l of run) {
        if (l.type === "del") {
          out.push(l.text);
        }
        // skip adds
      }
    } else {
      // accept / pending → new side
      for (const l of run) {
        if (l.type === "add") {
          out.push(l.text);
        }
        // skip dels
      }
    }
  }
  return out.join("\n");
}

/**
 * Build review state from old/new text.
 * @param oldText Prior content.
 * @param newText Proposed content.
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
 */
export function setHunkDecision(
  hunks: ReviewableHunk[],
  hunkId: string,
  decision: HunkDecision,
): ReviewableHunk[] {
  return hunks.map((h) => (h.id === hunkId ? { ...h, decision } : h));
}
