/**
 * Extract continuous add/del change runs from a structured FileDiff.
 * Order matches createDiffReview().hunks / applyHunkDecisions so review
 * decisions attach to the correct run. Gaps and same rows never split runs
 * incorrectly — only contiguous non-same rows form a run.
 */

import type { DiffRow, FileDiff } from "./diffCore";

/**
 * One continuous change run (document order).
 * `index` aligns with createDiffReview(...).hunks[i].
 */
export type ChangeRun = {
  /** 0-based index matching review hunk order. */
  index: number;
  /**
   * Stable keys for rows in this run (`type:oldNo:newNo`), used to place
   * accept/reject chrome on the first matching painted row.
   */
  rowKeys: string[];
  /** Count of add rows in the run. */
  added: number;
  /** Count of del rows in the run. */
  removed: number;
};

/**
 * Stable row identity for DOM keys / review chrome placement.
 * Type + dual line numbers already uniquely identify a row within a file.
 * @param row Diff row.
 */
export function diffRowKey(row: Pick<DiffRow, "type" | "oldNo" | "newNo">): string {
  return `${row.type}:${row.oldNo ?? ""}:${row.newNo ?? ""}`;
}

/**
 * Walk FileDiff blocks in document order and emit continuous add/del runs.
 * Gap blocks and same rows flush the current buffer (same as splitIntoHunks).
 * Expanded same rows inserted by gap reveal never create or destroy runs —
 * only add/del rows participate.
 *
 * @param fileDiff Structured diff from buildFileDiff (gaps ignored for run cut).
 * @returns Ordered change runs; length must equal createDiffReview().hunks.length.
 */
export function changeRunsFromFileDiff(fileDiff: FileDiff): ChangeRun[] {
  const runs: ChangeRun[] = [];
  let buf: DiffRow[] = [];
  let index = 0;

  const flush = () => {
    if (buf.length === 0) {
      return;
    }
    let added = 0;
    let removed = 0;
    const rowKeys: string[] = [];
    for (const row of buf) {
      rowKeys.push(diffRowKey(row));
      if (row.type === "add") {
        added += 1;
      } else if (row.type === "del") {
        removed += 1;
      }
    }
    runs.push({ index, rowKeys, added, removed });
    index += 1;
    buf = [];
  };

  for (const block of fileDiff.blocks) {
    if (block.kind === "gap") {
      flush();
      continue;
    }
    for (const row of block.rows) {
      if (row.type === "same") {
        flush();
        continue;
      }
      buf.push(row);
    }
  }
  flush();
  return runs;
}

/**
 * Map of rowKey → change-run index for O(1) chrome placement while painting.
 * @param runs Change runs from changeRunsFromFileDiff.
 */
export function changeRunIndexByRowKey(
  runs: ChangeRun[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const run of runs) {
    for (const key of run.rowKeys) {
      map.set(key, run.index);
    }
  }
  return map;
}
