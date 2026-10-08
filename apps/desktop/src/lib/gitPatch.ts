/**
 * Rebuild whole old / new file texts from one full-context unified diff
 * section (the bridge runs `git diff -U<huge>`, so every unchanged line is
 * present as context). Feeding the texts to buildFileDiff reuses the existing
 * diff renderer — gap expansion, word emphasis, line numbers — with git's own
 * view of the file (clean / CRLF filters already applied). Pure.
 */

/** Old / new texts recovered from a patch section. */
export type PatchTexts = {
  /** File content at the diff base ("" for added files). */
  oldText: string;
  /** Working-tree content ("" for deleted files). */
  newText: string;
  /** Number of `@@` hunks; 0 for binary, rename-only or mode-only changes. */
  hunks: number;
  /**
   * True when the patch spans whole files (one hunk starting at line 1, or
   * line 0 for an empty side). False means the texts hold only the changed
   * regions and line numbers / gap expansion would be wrong.
   */
  complete: boolean;
};

/** Matches `@@ -a[,b] +c[,d] @@` hunk headers. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Whether a hunk header starts at the top of both files.
 * @param header `@@` line.
 * @returns True for `-1,N +1,M` (or `-0,0` / `+0,0` for an empty side).
 */
function hunkStartsAtTop(header: string): boolean {
  const m = HUNK_HEADER.exec(header);
  if (!m) {
    return false;
  }
  const oldStart = Number(m[1]);
  const oldCount = m[2] === undefined ? 1 : Number(m[2]);
  const newStart = Number(m[3]);
  const newCount = m[4] === undefined ? 1 : Number(m[4]);
  const oldOk = oldCount === 0 ? oldStart <= 1 : oldStart === 1;
  const newOk = newCount === 0 ? newStart <= 1 : newStart === 1;
  return oldOk && newOk;
}

/**
 * Join collected lines back into file text.
 * @param lines Line bodies (without the diff prefix, `\r` kept).
 * @param noEol True when git marked the last line "\ No newline at end of file".
 * @returns File text; "" when there are no lines.
 */
function joinLines(lines: string[], noEol: boolean): string {
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n") + (noEol ? "" : "\n");
}

/**
 * Parse one file's unified diff section into old / new texts.
 * Header lines before the first `@@` are skipped. Context (` `) lines go to
 * both sides, `-` to old, `+` to new; a `\` marker strips the trailing
 * newline from whichever side(s) the previous line belonged to. Lines are
 * split on `\n` only, so CRLF content keeps its `\r`.
 * @param patch Section text from GitDiffFile.patch ("" yields empty texts).
 * @returns Recovered texts plus hunk count / completeness.
 */
export function patchToTexts(patch: string): PatchTexts {
  const lines = patch.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const noEol = { old: false, new: false };
  let hunks = 0;
  let complete = true;
  let last: "old" | "new" | "both" | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("@@")) {
      hunks += 1;
      complete = complete && hunks === 1 && hunkStartsAtTop(line);
      continue;
    }
    if (hunks === 0) {
      continue;
    }
    if (line === "" && i === lines.length - 1) {
      break;
    }
    const tag = line[0];
    const body = line.slice(1);
    if (tag === "+") {
      newLines.push(body);
      last = "new";
    } else if (tag === "-") {
      oldLines.push(body);
      last = "old";
    } else if (tag === "\\") {
      noEol.old = noEol.old || last === "old" || last === "both";
      noEol.new = noEol.new || last === "new" || last === "both";
    } else {
      // " " context (or a bare "" some tools emit for empty context lines).
      oldLines.push(body);
      newLines.push(body);
      last = "both";
    }
  }
  return {
    oldText: joinLines(oldLines, noEol.old),
    newText: joinLines(newLines, noEol.new),
    hunks,
    complete: hunks === 0 || complete,
  };
}
