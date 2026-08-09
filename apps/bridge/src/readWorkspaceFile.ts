/**
 * Safe workspace file read for @mention embedding.
 * Enforces path sandbox (resolveWorkspacePath), sensitive-name blocklist,
 * size/UTF-8/directory guards. Disk access stays on the bridge only.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "./workspacePath.js";

/** Single-file embed ceiling (bytes). Oversize files degrade to resource_link on the client. */
export const MAX_EMBED_FILE_BYTES = 256 * 1024;

/**
 * Failure reasons returned to the desktop; never include file body on failure.
 * - sensitive: name matches credential-like patterns
 * - too_large: exceeds MAX_EMBED_FILE_BYTES
 * - binary: not valid UTF-8 text (or contains NUL)
 * - directory: path is a directory (embed expands nothing)
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

/**
 * Basename / path patterns that must never be embedded (secrets).
 * Aligned with grok-build SENSITIVE_FILE_PATTERNS intent — bypassing gitignore
 * must not bypass credential protection.
 */
const SENSITIVE_BASENAME_RES: RegExp[] = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^credentials$/i,
  /^service-account.*\.json$/i,
  /\.kubeconfig$/i,
  /^secrets\.(json|ya?ml)$/i,
];

/**
 * Whether a workspace-relative path looks like a secret and must not be embedded.
 * @param relativePath Path as requested by the client (posix-ish).
 * @returns true when the basename matches a sensitive pattern.
 */
export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const base = path.basename(relativePath.replace(/\\/g, "/"));
  return SENSITIVE_BASENAME_RES.some((re) => re.test(base));
}

/**
 * Guess a text mime type from extension for embedded resource blocks.
 * @param relativePath Workspace-relative path.
 * @returns mimeType string; defaults to text/plain.
 */
export function guessTextMimeType(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return "text/markdown";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    return "text/plain";
  }
  if (ext === ".css" || ext === ".html" || ext === ".xml" || ext === ".svg") {
    return "text/plain";
  }
  if (ext === ".yml" || ext === ".yaml") {
    return "text/yaml";
  }
  return "text/plain";
}

/**
 * Detect non-text buffers: NUL bytes or invalid UTF-8 replacement from latin1 round-trip.
 * @param buf Raw file bytes.
 * @returns true when the content should not be embedded as text.
 */
function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.includes(0)) {
    return true;
  }
  // Reject high density of control chars outside tab/lf/cr (heuristic for binary).
  let control = 0;
  const sample = Math.min(buf.length, 8192);
  for (let i = 0; i < sample; i += 1) {
    const b = buf[i];
    if (b === undefined) {
      continue;
    }
    if (b < 9 || (b > 13 && b < 32)) {
      control += 1;
    }
  }
  return sample > 0 && control / sample > 0.1;
}

/**
 * Read a workspace file for @mention embedding with full safety guards.
 * @param workspaceAbs Absolute workspace root already resolved by the handler.
 * @param relativePath Client-supplied relative path (or abs under workspace).
 * @returns Result with content only when all guards pass; reason set on failure.
 */
export async function readWorkspaceFileForEmbed(
  workspaceAbs: string,
  relativePath: string,
): Promise<ReadWorkspaceFileResult> {
  if (isSensitiveWorkspacePath(relativePath)) {
    return { ok: false, bytes: 0, reason: "sensitive" };
  }

  let abs: string;
  try {
    abs = resolveWorkspacePath(workspaceAbs, relativePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/outside/i.test(message)) {
      return { ok: false, bytes: 0, reason: "outside", error: message };
    }
    return { ok: false, bytes: 0, reason: "error", error: message };
  }

  let st;
  try {
    st = await stat(abs);
  } catch {
    return { ok: false, bytes: 0, reason: "not_found" };
  }

  if (st.isDirectory()) {
    return { ok: false, bytes: 0, reason: "directory" };
  }

  const bytes = st.size;
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

  if (isBinaryBuffer(buf)) {
    return { ok: false, bytes: buf.length, reason: "binary" };
  }

  const content = buf.toString("utf8");
  // UTF-8 decode of invalid sequences produces U+FFFD; treat as binary when dense.
  if (content.includes("\uFFFD") && buf.length > 0) {
    const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
    if (replacementCount / content.length > 0.01) {
      return { ok: false, bytes: buf.length, reason: "binary" };
    }
  }

  return {
    ok: true,
    content,
    mimeType: guessTextMimeType(relativePath),
    bytes: buf.length,
  };
}
