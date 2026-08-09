/**
 * Pure helpers: committed @mentions → paths → ACP content blocks.
 * Disk I/O stays on the bridge; this module only shapes policy and blocks.
 * Snapshots are taken at send time — not live agent re-reads.
 */

import type { ContentBlock } from "@grok-desktop/acp-core";
import {
  materializeMentionTriggers,
  mentionDisplayLabel,
  splitMentionTokens,
} from "./mentionTokens";

/** Per-file embed ceiling (must match bridge MAX_EMBED_FILE_BYTES). */
export const MAX_EMBED_FILE_BYTES = 256 * 1024;

/** Aggregate embed budget for one prompt's resource blocks. */
export const MAX_EMBED_TOTAL_BYTES = 1024 * 1024;

/** Bridge read_workspace_file outcome consumed when assembling blocks. */
export type MentionFileReadResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  bytes: number;
  reason?: string;
  error?: string;
};

/** How a path was handled when building outgoing blocks. */
export type MentionAttachmentNotice =
  | { kind: "skipped_sensitive"; path: string }
  | { kind: "skipped_error"; path: string; reason?: string }
  | { kind: "degraded_link"; path: string; reason: string }
  | { kind: "truncated_budget"; path: string }
  | { kind: "directory_link"; path: string };

export type AssembleMentionBlocksArgs = {
  /** Wire text with visible @ / / (already materialized). */
  text: string;
  /**
   * Ordered committed file/dir paths (deduped) to attach.
   * Caller supplies paths from extractCommittedMentionPaths.
   */
  paths: string[];
  /**
   * Read each path via bridge; must never throw for policy reasons — return
   * { ok:false, reason } instead so the assembler can degrade explicitly.
   */
  readFile: (path: string) => Promise<MentionFileReadResult>;
  /**
   * Build a file:// URI for a workspace-relative path.
   * @param path Relative path from the mention.
   */
  toFileUri: (path: string) => string;
  /** Optional image (or other) blocks appended after mention resources. */
  extraBlocks?: ContentBlock[];
};

export type AssembleMentionBlocksResult = {
  /** Full prompt blocks: text first, then resources / links, then extras. */
  blocks: ContentBlock[];
  /** Wire text (same as input text). */
  text: string;
  /** Explicit skip/degrade notices for the composer hint. */
  notices: MentionAttachmentNotice[];
};

/**
 * Extract ordered unique workspace paths from committed @ file/dir mentions.
 * Skips `/command` mentions and freely typed (uncommitted) `@…` tokens.
 * @param draft Composer draft (may still contain zero-width marks).
 * @returns Paths in first-seen order with quotes stripped.
 */
export function extractCommittedMentionPaths(draft: string): string[] {
  const segments = splitMentionTokens(draft);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const seg of segments) {
    if (seg.type !== "mention") {
      continue;
    }
    if (!seg.committed) {
      continue;
    }
    if (seg.kind === "command") {
      continue;
    }
    const path = mentionDisplayLabel(seg.body).trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * Whether a path looks like a directory mention (trailing slash or no extension).
 * Matches the heuristic used by splitMentionTokens for kind classification.
 * @param path Workspace-relative path.
 */
export function isDirectoryMentionPath(path: string): boolean {
  return path.endsWith("/") || !path.includes(".");
}

/**
 * Human-readable composer hint from attachment notices.
 * @param notices Ordered notices from assembleMentionBlocks.
 * @returns Empty string when nothing to report; otherwise a single hint line.
 */
export function formatMentionAttachmentHint(
  notices: MentionAttachmentNotice[],
): string {
  if (notices.length === 0) {
    return "";
  }
  const parts: string[] = [];
  const sensitive = notices
    .filter((n) => n.kind === "skipped_sensitive")
    .map((n) => n.path);
  if (sensitive.length > 0) {
    parts.push(`Skipped sensitive: ${sensitive.join(", ")}`);
  }
  const skipped = notices
    .filter((n) => n.kind === "skipped_error")
    .map((n) => n.path);
  if (skipped.length > 0) {
    parts.push(`Could not attach: ${skipped.join(", ")}`);
  }
  const degraded = notices
    .filter((n) => n.kind === "degraded_link" || n.kind === "directory_link")
    .map((n) => n.path);
  if (degraded.length > 0) {
    parts.push(`Linked (not embedded): ${degraded.join(", ")}`);
  }
  const truncated = notices
    .filter((n) => n.kind === "truncated_budget")
    .map((n) => n.path);
  if (truncated.length > 0) {
    parts.push(`Embed budget full — truncated: ${truncated.join(", ")}`);
  }
  return parts.join(" · ");
}

/**
 * Assemble text + embedded resource / resource_link blocks for committed mentions.
 * Policy: sensitive → omit; too_large/binary → resource_link; directory → resource_link;
 * aggregate budget 1 MB with ordered truncation (remaining paths become links).
 * @param args Text, paths, bridge read, and URI helper.
 * @returns Blocks (text always first when non-empty), notices for UI.
 */
export async function assembleMentionBlocks(
  args: AssembleMentionBlocksArgs,
): Promise<AssembleMentionBlocksResult> {
  const notices: MentionAttachmentNotice[] = [];
  const resourceBlocks: ContentBlock[] = [];
  let totalEmbedBytes = 0;

  for (const relPath of args.paths) {
    if (isDirectoryMentionPath(relPath)) {
      resourceBlocks.push({
        type: "resource_link",
        uri: args.toFileUri(relPath),
        name: relPath,
      });
      notices.push({ kind: "directory_link", path: relPath });
      continue;
    }

    const read = await args.readFile(relPath);
    if (!read.ok) {
      if (read.reason === "sensitive") {
        notices.push({ kind: "skipped_sensitive", path: relPath });
        continue;
      }
      if (
        read.reason === "too_large" ||
        read.reason === "binary" ||
        read.reason === "directory"
      ) {
        resourceBlocks.push({
          type: "resource_link",
          uri: args.toFileUri(relPath),
          name: relPath,
        });
        notices.push({
          kind: read.reason === "directory" ? "directory_link" : "degraded_link",
          path: relPath,
          reason: read.reason,
        });
        continue;
      }
      notices.push({
        kind: "skipped_error",
        path: relPath,
        reason: read.reason,
      });
      continue;
    }

    const content = read.content ?? "";
    const contentBytes =
      read.bytes || new TextEncoder().encode(content).length;
    if (totalEmbedBytes + contentBytes > MAX_EMBED_TOTAL_BYTES) {
      resourceBlocks.push({
        type: "resource_link",
        uri: args.toFileUri(relPath),
        name: relPath,
      });
      notices.push({ kind: "truncated_budget", path: relPath });
      continue;
    }

    totalEmbedBytes += contentBytes;
    resourceBlocks.push({
      type: "resource",
      resource: {
        uri: args.toFileUri(relPath),
        text: content,
        mimeType: read.mimeType,
      },
    });
  }

  const blocks: ContentBlock[] = [];
  if (args.text.trim()) {
    blocks.push({ type: "text", text: args.text });
  }
  blocks.push(...resourceBlocks);
  if (args.extraBlocks && args.extraBlocks.length > 0) {
    blocks.push(...args.extraBlocks);
  }

  return { blocks, text: args.text, notices };
}

/**
 * Convenience: materialize draft triggers then extract committed mention paths.
 * @param draft Composer draft that may contain zero-width marks.
 * @returns Wire text and ordered unique paths.
 */
export function prepareMentionSend(draft: string): {
  text: string;
  paths: string[];
} {
  const text = materializeMentionTriggers(draft);
  // Extract from original draft so committed marks still classify correctly;
  // paths are label bodies without triggers.
  const paths = extractCommittedMentionPaths(draft);
  return { text, paths };
}
