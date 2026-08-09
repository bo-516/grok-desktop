/**
 * Drag-drop helpers for composer (F-NATIVE-05): files → @mentions, images → attachments.
 */

import { MENTION_AT_MARK } from "./mentionTokens";
import {
  fileToImageAttachment,
  type ImageAttachment,
} from "./mediaInput";

export type DropResult = {
  /** Workspace-relative or basename paths to insert as @mentions. */
  fileMentions: string[];
  /** Image attachments ready for ContentBlock.image. */
  images: ImageAttachment[];
  /** Non-image files that could not be turned into attachments. */
  skipped: string[];
};

/**
 * Process a DataTransfer from drop/paste-like sources.
 * @param dataTransfer Browser DataTransfer.
 * @param opts.preferRelative When true, use webkitRelativePath or name for @ path.
 */
export async function processDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
  opts: { preferRelative?: boolean } = {},
): Promise<DropResult> {
  const fileMentions: string[] = [];
  const images: ImageAttachment[] = [];
  const skipped: string[] = [];
  if (!dataTransfer) {
    return { fileMentions, images, skipped };
  }

  const files = Array.from(dataTransfer.files ?? []);
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      const att = await fileToImageAttachment(file);
      if (att) {
        images.push(att);
      } else {
        skipped.push(file.name);
      }
      continue;
    }
    // Text/code files → @mention token using path-ish name
    const pathHint =
      (opts.preferRelative &&
        "webkitRelativePath" in file &&
        typeof (file as File & { webkitRelativePath?: string })
          .webkitRelativePath === "string" &&
        (file as File & { webkitRelativePath: string }).webkitRelativePath) ||
      file.name;
    if (pathHint) {
      fileMentions.push(pathHint.replace(/^\/+/, ""));
    } else {
      skipped.push(file.name || "unknown");
    }
  }

  // Also honor text/uri-list drops (file:// paths)
  const uriList = dataTransfer.getData("text/uri-list");
  if (uriList) {
    for (const line of uriList.split("\n")) {
      const u = line.trim();
      if (!u || u.startsWith("#")) {
        continue;
      }
      if (u.startsWith("file://")) {
        try {
          const p = decodeURIComponent(u.replace(/^file:\/\//, ""));
          const base = p.split(/[/\\]/).pop();
          if (base) {
            fileMentions.push(base);
          }
        } catch {
          skipped.push(u);
        }
      }
    }
  }

  return { fileMentions, images, skipped };
}

/**
 * Insert committed file-mention tokens into draft text at caret (or end).
 * Uses the zero-width `@` mark so the composer mirror shows only the path.
 * @param draft Current composer text.
 * @param paths Paths to mention.
 * @param caret Optional caret index; defaults to end.
 */
export function insertFileMentions(
  draft: string,
  paths: string[],
  caret?: number,
): { text: string; caret: number } {
  if (paths.length === 0) {
    return { text: draft, caret: caret ?? draft.length };
  }
  const tokens = paths
    .map((p) => {
      const needsQuote = /[\s"]/.test(p);
      return needsQuote
        ? `${MENTION_AT_MARK}"${p.replace(/"/g, '\\"')}"`
        : `${MENTION_AT_MARK}${p}`;
    })
    .join(" ");
  const at = typeof caret === "number" ? caret : draft.length;
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const insert =
    (needsSpaceBefore ? " " : "") +
    tokens +
    (needsSpaceAfter ? " " : "");
  const text = before + insert + after;
  return { text, caret: before.length + insert.length };
}
