/**
 * Pure line-level diff helpers for tool edit cards and native diff review (F-TOOL-04 / F-NATIVE-06).
 */

export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
  /** 1-based line number in new file for add/same; old for del. */
  lineNo?: number;
};

export type DiffHunk = {
  /** Summary like +3/-1 */
  summary: string;
  lines: DiffLine[];
  added: number;
  removed: number;
};

/**
 * Build a simple LCS-free line diff (patience-free sequential) for UI review.
 * Good enough for tool cards; not a full Myers algorithm.
 * @param oldText Previous file content (empty for new files).
 * @param newText Updated file content.
 */
export function buildLineDiff(
  oldText: string | undefined | null,
  newText: string | undefined | null,
): DiffHunk {
  const oldLines = String(oldText ?? "").split("\n");
  const newLines = String(newText ?? "").split("\n");
  // Empty single trailing: treat fully empty as zero lines
  const a =
    oldText == null || oldText === ""
      ? []
      : oldLines[oldLines.length - 1] === "" && oldLines.length > 1
        ? oldLines.slice(0, -1)
        : oldLines;
  const b =
    newText == null || newText === ""
      ? []
      : newLines[newLines.length - 1] === "" && newLines.length > 1
        ? newLines.slice(0, -1)
        : newLines;

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ type: "same", text: a[i]!, lineNo: j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    // Prefer deletions then additions when mismatch
    if (
      i < a.length &&
      (j >= b.length || !b.slice(j).includes(a[i]!))
    ) {
      lines.push({ type: "del", text: a[i]!, lineNo: i + 1 });
      removed += 1;
      i += 1;
      continue;
    }
    if (j < b.length) {
      lines.push({ type: "add", text: b[j]!, lineNo: j + 1 });
      added += 1;
      j += 1;
      continue;
    }
    lines.push({ type: "del", text: a[i]!, lineNo: i + 1 });
    removed += 1;
    i += 1;
  }
  return {
    summary: `+${added}/-${removed}`,
    lines,
    added,
    removed,
  };
}

/**
 * Parse MCP tool title `server__tool` into parts for badge display (F-TOOL-08).
 * @param title Tool card title or name.
 */
export function parseMcpToolName(
  title: string | undefined,
): { server: string; tool: string } | null {
  if (!title || !title.includes("__")) {
    return null;
  }
  const idx = title.indexOf("__");
  const server = title.slice(0, idx);
  const tool = title.slice(idx + 2);
  if (!server || !tool) {
    return null;
  }
  return { server, tool };
}

/**
 * Whether consecutive tool kinds should collapse for timeline readability (F-TOOL-06).
 * @param kind Tool kind.
 */
export function isCollapsibleToolKind(kind: string | undefined): boolean {
  return kind === "read" || kind === "search" || kind === "list";
}
