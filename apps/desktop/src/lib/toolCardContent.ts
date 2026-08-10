/**
 * Pure helpers for tool-card content parsing and edit summaries (D3).
 * Extracted from ToolCardView so summary rows and tests share one path.
 */

import { buildFileDiff } from "./diffCore";

/** Diff fragment shape inside ACP tool content. */
export type ToolDiffFragment = {
  type?: string;
  path?: string;
  oldText?: string;
  newText?: string;
};

/** One edit path summary for the timeline compact row. */
export type EditContentSummary = {
  path: string;
  added: number;
  removed: number;
  /** False when oldText was absent (whole file treated as add). */
  hasBaseline: boolean;
  /** True when content has no usable old/new texts. */
  noDiffData: boolean;
  /** True when the diff engine degraded (size / maxEditLength). */
  degraded: boolean;
};

/**
 * Normalize tool content into an object array.
 * Supports a single object, a JSON array, or unknown shapes.
 * @param content toolCalls[id].content; undefined means no body yet.
 * @returns Array of content part objects (never null items).
 */
export function normalizeToolContentParts(
  content: unknown,
): Array<Record<string, unknown>> {
  if (content == null) {
    return [];
  }
  if (Array.isArray(content)) {
    return content.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (typeof content === "object") {
    return [content as Record<string, unknown>];
  }
  return [];
}

/**
 * Extract readable text from a content fragment (type=content/text or text field).
 * Diff parts return null so they are not double-rendered as plain text.
 * @param part Normalized content item.
 * @returns Text body or null when the part is not textual.
 */
export function extractToolText(part: Record<string, unknown>): string | null {
  if (part.type === "diff") {
    return null;
  }
  if (typeof part.text === "string" && part.text) {
    return part.text;
  }
  const nested = part.content;
  if (typeof nested === "string" && nested) {
    return nested;
  }
  if (Array.isArray(nested)) {
    const chunks = nested
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") {
          return rec.text;
        }
        return "";
      })
      .filter(Boolean);
    return chunks.length > 0 ? chunks.join("\n") : null;
  }
  if (nested && typeof nested === "object") {
    const n = nested as { type?: string; text?: string };
    if (typeof n.text === "string" && n.text) {
      return n.text;
    }
  }
  return null;
}

/**
 * Normalize locations array for file jump links.
 * @param raw card.rawLocations from agent.
 * @returns Ordered path/uri strings.
 */
export function normalizeLocations(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (typeof raw === "string") {
    return [raw];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push(item);
    } else if (item && typeof item === "object") {
      const rec = item as { path?: string; uri?: string };
      if (rec.path) {
        out.push(rec.path);
      } else if (rec.uri) {
        out.push(rec.uri);
      }
    }
  }
  return out;
}

/**
 * Summarize every diff fragment on a tool card for compact timeline rows.
 * @param content Tool card content (array or single object).
 * @returns One summary per path; empty when there are no diffs.
 */
export function summarizeEditContent(content: unknown): EditContentSummary[] {
  const parts = normalizeToolContentParts(content);
  const diffs = parts.filter(
    (p): p is ToolDiffFragment & Record<string, unknown> => p.type === "diff",
  );
  const out: EditContentSummary[] = [];
  for (const diff of diffs) {
    const path =
      typeof diff.path === "string" && diff.path ? diff.path : "(unknown)";
    const oldText =
      typeof diff.oldText === "string" ? diff.oldText : undefined;
    const newText =
      typeof diff.newText === "string" ? diff.newText : undefined;
    const hasOld = oldText !== undefined;
    const hasNew = newText !== undefined;
    if (!hasOld && !hasNew) {
      out.push({
        path,
        added: 0,
        removed: 0,
        hasBaseline: false,
        noDiffData: true,
        degraded: false,
      });
      continue;
    }
    const fileDiff = buildFileDiff(oldText ?? "", newText ?? "");
    out.push({
      path,
      added: fileDiff.added,
      removed: fileDiff.removed,
      hasBaseline: hasOld,
      noDiffData: false,
      degraded: Boolean(fileDiff.degraded),
    });
  }
  return out;
}
