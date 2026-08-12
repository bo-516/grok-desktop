/**
 * Full-file reconstruction from ACP window fragments + Apply whole-file safety.
 * Pure: no React, no bridge. Callers read disk via previewWorkspaceFile and pass
 * the text here. Line-boundary matching only — never mid-line indexOf.
 */

/**
 * Alignment between an agent diff fragment and the on-disk file.
 * Drives line-number semantics, expand bounds, and Apply availability.
 */
export type FullFileAlign =
  | { kind: "whole"; oldText: string; newText: string }
  | {
      kind: "window";
      oldText: string;
      newText: string;
      /** 1-based absolute line of the first fragment line on the new side. */
      startLine: number;
    }
  | {
      kind: "unavailable";
      reason: "not_found" | "ambiguous" | "stale" | "empty_frag";
    };

/**
 * Whether a fragment may safely replace the whole on-disk file.
 * True only when disk content equals the fragment new side byte-for-byte —
 * meaning the fragment is already the full file (or an identical rewrite).
 * Window fragments fail this check and must not be written with writeWorkspaceFile.
 *
 * @param diskText Current file contents from previewWorkspaceFile.
 * @param newText Fragment (or reconstructed) new-side text about to be written.
 * @returns true only when write-back will not truncate or invent content.
 */
export function canApplyWholeFile(diskText: string, newText: string): boolean {
  return diskText === newText;
}

/**
 * Chinese Apply-disable reasons shown in the review footer (doc §2.1).
 * @param kind Why Apply is blocked.
 */
export function applyDisabledReason(
  kind: "unverified" | "partial" | "unavailable",
): string {
  if (kind === "unverified") {
    return "无法校验文件完整性，已停用写回";
  }
  if (kind === "partial") {
    return "此 diff 只覆盖文件的一部分，写回会截断文件";
  }
  return "无法与磁盘对齐，已停用写回";
}

/**
 * Human label for an unavailable reconstruction reason (banner copy).
 * @param reason Machine reason from reconstructFullTexts / changeSet.
 */
export function fullFileUnavailableLabel(
  reason: "not_found" | "ambiguous" | "stale" | "empty_frag" | string,
): string {
  if (reason === "not_found") {
    return "磁盘内容已变化";
  }
  if (reason === "ambiguous") {
    return "片段在文件中出现多次";
  }
  if (reason === "stale") {
    return "多段编辑窗口不连续";
  }
  if (reason === "empty_frag") {
    return "片段为空";
  }
  return reason;
}

/**
 * Split text into lines the same way diffCore / gap expand do (no invented
 * trailing empty segment for a final newline).
 * @param text Source text.
 */
export function splitLinesForMatch(text: string): string[] {
  if (text === "") {
    return [];
  }
  if (text.endsWith("\n")) {
    return text.slice(0, -1).split("\n");
  }
  return text.split("\n");
}

/**
 * Join lines back with `\n`, preserving whether the original ended with newline
 * when `endedWithNewline` is true (disk side always joins with `\n` between
 * lines; trailing newline follows disk when reconstructing).
 * @param lines Line array without embedded newlines.
 * @param endedWithNewline Whether the source string ended with `\n`.
 */
function joinLines(lines: string[], endedWithNewline: boolean): string {
  if (lines.length === 0) {
    return endedWithNewline ? "\n" : "";
  }
  const body = lines.join("\n");
  return endedWithNewline ? `${body}\n` : body;
}

/**
 * Find every start index where `needle` lines equal a contiguous slice of `hay`.
 * Matching is whole-line only (no mid-line substring match).
 *
 * @param hay Disk / full-file lines.
 * @param needle Fragment lines (must be non-empty).
 * @returns 0-based start indices of every full match.
 */
export function findLineSubsequenceStarts(
  hay: string[],
  needle: string[],
): number[] {
  if (needle.length === 0) {
    return [];
  }
  if (needle.length > hay.length) {
    return [];
  }
  const starts: number[] = [];
  const last = hay.length - needle.length;
  for (let i = 0; i <= last; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
    }
  }
  return starts;
}

/**
 * Rebuild full old/new texts from a window fragment using the on-disk new side.
 *
 * Agent writes happen before the fragment is shown, so disk === post-edit full
 * file. When fragNew appears exactly once as a line-aligned window, replace that
 * span with fragOld to recover the pre-edit full file. Unique match only —
 * zero or many matches → unavailable (never invent a wrong offset).
 *
 * @param diskText Current disk contents (new-side full file after agent write).
 * @param fragOld Fragment old-side text.
 * @param fragNew Fragment new-side text.
 * @returns whole | window (with 1-based startLine) | unavailable.
 */
export function reconstructFullTexts(
  diskText: string,
  fragOld: string,
  fragNew: string,
): FullFileAlign {
  // Pure delete / empty new fragment cannot be located on disk as a window.
  if (fragNew === "") {
    return { kind: "unavailable", reason: "empty_frag" };
  }

  if (diskText === fragNew) {
    return { kind: "whole", oldText: fragOld, newText: fragNew };
  }

  const diskLines = splitLinesForMatch(diskText);
  const fragNewLines = splitLinesForMatch(fragNew);
  const fragOldLines = splitLinesForMatch(fragOld);
  const starts = findLineSubsequenceStarts(diskLines, fragNewLines);

  if (starts.length === 0) {
    return { kind: "unavailable", reason: "not_found" };
  }
  if (starts.length > 1) {
    return { kind: "unavailable", reason: "ambiguous" };
  }

  const startIdx = starts[0]!;
  const endIdx = startIdx + fragNewLines.length;
  const oldLines = [
    ...diskLines.slice(0, startIdx),
    ...fragOldLines,
    ...diskLines.slice(endIdx),
  ];
  const diskEndedNl = diskText.endsWith("\n");
  const oldText = joinLines(oldLines, diskEndedNl);
  // New side is the full disk file (byte-stable when possible).
  const newText = diskText;
  return {
    kind: "window",
    oldText,
    newText,
    startLine: startIdx + 1,
  };
}

/**
 * Whether successive fragments on one path look continuous enough to merge.
 * Continuity: the later fragment's oldText must equal or be a line-boundary
 * subsequence of the earlier head (prior newText). Otherwise the merged base/head
 * pair is not one coherent edit and must not be diffed as if it were.
 *
 * @param priorNew Head text after applying previous fragments.
 * @param nextOld Old text of the incoming fragment.
 * @returns true when merge is safe; false → mark stale / unavailable.
 */
export function fragmentsAreContinuous(
  priorNew: string,
  nextOld: string,
): boolean {
  if (nextOld === priorNew) {
    return true;
  }
  // Empty next old (pure add fragment) is only continuous when prior is empty.
  if (nextOld === "") {
    return priorNew === "";
  }
  if (priorNew === "") {
    return false;
  }
  const priorLines = splitLinesForMatch(priorNew);
  const nextOldLines = splitLinesForMatch(nextOld);
  const starts = findLineSubsequenceStarts(priorLines, nextOldLines);
  return starts.length >= 1;
}
