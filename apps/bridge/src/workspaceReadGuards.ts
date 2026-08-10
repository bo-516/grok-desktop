/**
 * Shared workspace read guards for embed + preview RPCs.
 * Sensitive basename blocklist, binary detection, and text mime guessing.
 * Kept in one module so preview and embed policies cannot drift.
 */

import path from "node:path";

/**
 * Basename / path patterns that must never be returned as file body (secrets).
 * Aligned with grok-build SENSITIVE_FILE_PATTERNS intent.
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
 * Whether a workspace-relative path looks like a secret and must not be served.
 * @param relativePath Path as requested by the client (posix-ish).
 * @returns true when the basename matches a sensitive pattern.
 */
export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const base = path.basename(relativePath.replace(/\\/g, "/"));
  return SENSITIVE_BASENAME_RES.some((re) => re.test(base));
}

/**
 * Guess a text mime type from extension for embedded / preview resource blocks.
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
 * Detect non-text buffers: NUL bytes or high density of control chars.
 * @param buf Raw file bytes.
 * @returns true when the content should not be served as text.
 */
export function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.includes(0)) {
    return true;
  }
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
 * Whether a UTF-8 decoded string looks binary due to replacement density.
 * @param content Decoded UTF-8 string.
 * @param byteLength Original buffer length (for empty guard).
 * @returns true when U+FFFD density exceeds 1%.
 */
export function isBinaryUtf8Replacement(
  content: string,
  byteLength: number,
): boolean {
  if (byteLength <= 0 || !content.includes("\uFFFD")) {
    return false;
  }
  const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
  return replacementCount / content.length > 0.01;
}
