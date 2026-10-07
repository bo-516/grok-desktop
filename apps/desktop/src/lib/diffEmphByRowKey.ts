/**
 * Word-emphasis lookup for a structured file diff: groups consecutive
 * del/add rows into change runs, pairs them through wordRangesForRun, and
 * keys the resulting ranges by diffRowKey for the row renderer.
 * Pure; extracted from PreviewDiffWidget so the widget only memoizes it.
 */

import { diffRowKey } from "./diffChangeRuns";
import type { FileDiff } from "./diffCore";
import { wordRangesForRun, type EmphRange } from "./diffWordRanges";

/**
 * Build rowKey → emph ranges for every add/del row in each change run.
 * Same rows and unpaired extras get no entry (row bg only).
 * @param fileDiff Structured diff (degraded short-circuits to empty map).
 * @returns Fresh map; rows whose ranges are empty are omitted, so a missing
 *   key means "row background only", never an error.
 */
export function buildEmphByRowKey(fileDiff: FileDiff): Map<string, EmphRange[]> {
  const map = new Map<string, EmphRange[]>();
  if (fileDiff.degraded) {
    return map;
  }
  const runs: Array<{
    dels: Array<{ key: string; text: string }>;
    adds: Array<{ key: string; text: string }>;
  }> = [];
  let dels: Array<{ key: string; text: string }> = [];
  let adds: Array<{ key: string; text: string }> = [];
  /** Close the open del/add run (no-op when empty) and start a fresh one. */
  function flush(): void {
    if (dels.length === 0 && adds.length === 0) {
      return;
    }
    runs.push({ dels, adds });
    dels = [];
    adds = [];
  }
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
      if (row.type === "del") {
        dels.push({ key: diffRowKey(row), text: row.text });
      } else {
        adds.push({ key: diffRowKey(row), text: row.text });
      }
    }
  }
  flush();

  for (const run of runs) {
    const ranges = wordRangesForRun(
      run.dels.map((d) => d.text),
      run.adds.map((a) => a.text),
      { degraded: fileDiff.degraded },
    );
    for (let i = 0; i < run.dels.length; i += 1) {
      const r = ranges.del[i];
      const row = run.dels[i];
      if (r && r.length > 0 && row) {
        map.set(row.key, r);
      }
    }
    for (let i = 0; i < run.adds.length; i += 1) {
      const r = ranges.add[i];
      const row = run.adds[i];
      if (r && r.length > 0 && row) {
        map.set(row.key, r);
      }
    }
  }
  return map;
}
