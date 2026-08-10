/**
 * Safe workspace file read for @mention embedding and preview.
 * Enforces path sandbox (resolveWorkspacePath), sensitive-name blocklist,
 * size/UTF-8/directory guards. Disk access stays on the bridge only.
 */

import { open, readFile, stat } from "node:fs/promises";
import { resolveWorkspacePath } from "./workspacePath.js";
import {
  guessTextMimeType,
  isBinaryBuffer,
  isBinaryUtf8Replacement,
  isSensitiveWorkspacePath,
} from "./workspaceReadGuards.js";

export {
  guessTextMimeType,
  isSensitiveWorkspacePath,
} from "./workspaceReadGuards.js";

/** Single-file embed ceiling (bytes). Oversize files degrade to resource_link on the client. */
export const MAX_EMBED_FILE_BYTES = 256 * 1024;

/**
 * Preview read ceiling (bytes). Oversize files are truncated (not rejected)
 * and returned with truncated: true.
 */
export const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;

/**
 * Failure reasons returned to the desktop; never include file body on failure
 * (except preview truncation which still sets ok:true with a truncated body).
 * - sensitive: name matches credential-like patterns
 * - too_large: exceeds MAX_EMBED_FILE_BYTES (embed only)
 * - binary: not valid UTF-8 text (or contains NUL)
 * - directory: path is a directory
 * - not_found / outside / error: path resolution or IO failures
 */
export type ReadWorkspaceFileReason =
  | "sensitive"
  | "too_large"
  | "binary"
  | "directory"
  | "not_found"
  | "outside"
  | "error";

/** Successful or guarded-failure result for one read_workspace_file request. */
export type ReadWorkspaceFileResult = {
  ok: boolean;
  /** UTF-8 file body when ok; never set when ok is false. */
  content?: string;
  mimeType?: string;
  /** Byte length of the file on disk (or content when ok). */
  bytes: number;
  reason?: ReadWorkspaceFileReason;
  error?: string;
};

/** Result for preview_workspace_file (may truncate instead of hard-failing). */
export type PreviewWorkspaceFileResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  /** Full file size on disk (not the truncated length). */
  bytes: number;
  /** True when content was cut at maxBytes. */
  truncated?: boolean;
  reason?: ReadWorkspaceFileReason;
  error?: string;
};

/**
 * Shared open + guard path used by embed and preview readers.
 * @param workspaceAbs Absolute workspace root.
 * @param relativePath Client-supplied relative path.
 * @returns Absolute path + stat size, or a failure result.
 */
async function resolveReadableFile(
  workspaceAbs: string,
  relativePath: string,
): Promise<
  | { ok: true; abs: string; bytes: number }
  | { ok: false; result: ReadWorkspaceFileResult }
> {
  if (isSensitiveWorkspacePath(relativePath)) {
    return { ok: false, result: { ok: false, bytes: 0, reason: "sensitive" } };
  }

  let abs: string;
  try {
    abs = resolveWorkspacePath(workspaceAbs, relativePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/outside/i.test(message)) {
      return {
        ok: false,
        result: { ok: false, bytes: 0, reason: "outside", error: message },
      };
    }
    return {
      ok: false,
      result: { ok: false, bytes: 0, reason: "error", error: message },
    };
  }

  let st;
  try {
    st = await stat(abs);
  } catch {
    return { ok: false, result: { ok: false, bytes: 0, reason: "not_found" } };
  }

  if (st.isDirectory()) {
    return {
      ok: false,
      result: { ok: false, bytes: 0, reason: "directory" },
    };
  }

  return { ok: true, abs, bytes: st.size };
}

/**
 * Decode buffer as text after binary / UTF-8 replacement checks.
 * @param buf Raw bytes.
 * @param relativePath For mime guessing on success.
 * @returns Content + mime or a binary failure.
 */
function decodeTextBuffer(
  buf: Buffer,
  relativePath: string,
):
  | { ok: true; content: string; mimeType: string; bytes: number }
  | { ok: false; reason: "binary"; bytes: number } {
  if (isBinaryBuffer(buf)) {
    return { ok: false, reason: "binary", bytes: buf.length };
  }
  const content = buf.toString("utf8");
  if (isBinaryUtf8Replacement(content, buf.length)) {
    return { ok: false, reason: "binary", bytes: buf.length };
  }
  return {
    ok: true,
    content,
    mimeType: guessTextMimeType(relativePath),
    bytes: buf.length,
  };
}

/**
 * Read a workspace file for @mention embedding with full safety guards.
 * Hard-fails on oversize (no content). Does not set truncated.
 * @param workspaceAbs Absolute workspace root already resolved by the handler.
 * @param relativePath Client-supplied relative path (or abs under workspace).
 * @returns Result with content only when all guards pass; reason set on failure.
 */
export async function readWorkspaceFileForEmbed(
  workspaceAbs: string,
  relativePath: string,
): Promise<ReadWorkspaceFileResult> {
  const resolved = await resolveReadableFile(workspaceAbs, relativePath);
  if (!resolved.ok) {
    return resolved.result;
  }

  const { abs, bytes } = resolved;
  if (bytes > MAX_EMBED_FILE_BYTES) {
    return { ok: false, bytes, reason: "too_large" };
  }

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch (e) {
    return {
      ok: false,
      bytes,
      reason: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const decoded = decodeTextBuffer(buf, relativePath);
  if (!decoded.ok) {
    return { ok: false, bytes: decoded.bytes, reason: decoded.reason };
  }

  return {
    ok: true,
    content: decoded.content,
    mimeType: decoded.mimeType,
    bytes: decoded.bytes,
  };
}

/**
 * Read a workspace file for the preview drawer.
 * Sensitive / binary / directory / outside still reject; oversize truncates
 * to the first maxBytes with truncated: true and ok: true.
 * @param workspaceAbs Absolute workspace root.
 * @param relativePath Client path.
 * @param maxBytes Optional ceiling (default MAX_PREVIEW_FILE_BYTES).
 * @returns Preview result; content present when ok even if truncated.
 */
export async function readWorkspaceFileForPreview(
  workspaceAbs: string,
  relativePath: string,
  maxBytes: number = MAX_PREVIEW_FILE_BYTES,
): Promise<PreviewWorkspaceFileResult> {
  const ceiling =
    Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(Math.floor(maxBytes), MAX_PREVIEW_FILE_BYTES)
      : MAX_PREVIEW_FILE_BYTES;

  const resolved = await resolveReadableFile(workspaceAbs, relativePath);
  if (!resolved.ok) {
    return resolved.result;
  }

  const { abs, bytes } = resolved;
  const truncated = bytes > ceiling;

  let buf: Buffer;
  try {
    if (truncated) {
      // Cap memory: only the first ceiling bytes are needed for preview.
      const fh = await open(abs, "r");
      try {
        const tmp = Buffer.alloc(ceiling);
        const { bytesRead } = await fh.read(tmp, 0, ceiling, 0);
        buf = tmp.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    } else {
      buf = await readFile(abs);
    }
  } catch (e) {
    return {
      ok: false,
      bytes,
      reason: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const decoded = decodeTextBuffer(buf, relativePath);
  if (!decoded.ok) {
    return { ok: false, bytes, reason: decoded.reason };
  }

  return {
    ok: true,
    content: decoded.content,
    mimeType: decoded.mimeType,
    bytes,
    truncated: truncated || undefined,
  };
}
