/**
 * Pure line-level diff helpers for tool edit cards and native diff review.
 * Internals use jsdiff via diffCore (D4); external shape stays compatible.
 */

import {
  buildFileDiff,
  flattenFileDiffRows,
  type DiffRow,
} from "./diffCore";

export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
  /**
   * Legacy single line number: del → old, add/same → new.
   * Prefer oldNo/newNo for dual gutters.
   */
  lineNo?: number;
  /** 1-based old-file line number; undefined on add rows. */
  oldNo?: number;
  /** 1-based new-file line number; undefined on del rows. */
  newNo?: number;
};

export type DiffHunk = {
  /** Summary like +3/-1 */
  summary: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the engine bailed to a whole-file replace view. */
  degraded?: boolean;
};

/**
 * Build a line-level diff for UI review.
 * Signature and return shape match the pre-jsdiff API; dual line numbers are
 * filled in addition to the legacy lineNo field.
 * @param oldText Previous file content (empty for new files).
 * @param newText Updated file content.
 * @returns Summary, flat lines, and added/removed counts.
 */
export function buildLineDiff(
  oldText: string | undefined | null,
  newText: string | undefined | null,
): DiffHunk {
  const fileDiff = buildFileDiff(oldText, newText);
  const rows = flattenFileDiffRows(fileDiff, false);
  const lines: DiffLine[] = rows.map((row) => rowToDiffLine(row));
  return {
    summary: `+${fileDiff.added}/-${fileDiff.removed}`,
    lines,
    added: fileDiff.added,
    removed: fileDiff.removed,
    degraded: fileDiff.degraded,
  };
}

/**
 * Map a DiffRow onto the legacy DiffLine shape with dual numbers.
 * @param row Structured dual-numbered row.
 */
function rowToDiffLine(row: DiffRow): DiffLine {
  const lineNo =
    row.type === "del"
      ? row.oldNo
      : row.newNo !== undefined
        ? row.newNo
        : row.oldNo;
  return {
    type: row.type,
    text: row.text,
    lineNo,
    oldNo: row.oldNo,
    newNo: row.newNo,
  };
}

/**
 * Parse MCP tool title `server__tool` into parts for badge display (F-TOOL-08).
 * @param title Tool card title or name.
 * @returns Server/tool pair or null when the title is not MCP-shaped.
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
 * @returns True for read/search/list only.
 */
export function isCollapsibleToolKind(kind: string | undefined): boolean {
  return kind === "read" || kind === "search" || kind === "list";
}
