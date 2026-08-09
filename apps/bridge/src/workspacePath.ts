/**
 * Workspace path boundary helpers for reverse fs services.
 * Uses path.relative (not string prefix) so neighbor dirs like demo-evil cannot slip past.
 */

import path from "node:path";

/**
 * Resolve a client-supplied path under workspace and reject escapes.
 * @param workspaceAbs Absolute workspace root (already resolved).
 * @param requested Relative or absolute path from the agent reverse request.
 * @returns Absolute path inside workspace.
 * @throws When the resolved path leaves the workspace (including `..`, prefix-neighbor, symlink-style abs).
 */
export function resolveWorkspacePath(
  workspaceAbs: string,
  requested: string | undefined | null,
): string {
  const root = path.resolve(workspaceAbs);
  const raw = requested == null || requested === "" ? "." : String(requested);
  const abs = path.resolve(root, raw);
  if (!isPathInsideWorkspace(root, abs)) {
    throw new Error(`path outside workspace: ${raw}`);
  }
  return abs;
}

/**
 * Whether abs is inside root (or is root itself).
 * @param workspaceAbs Absolute workspace root.
 * @param candidateAbs Absolute candidate path.
 * @returns true only when candidate is root or a descendant; false for prefix-neighbor or parent escapes.
 */
export function isPathInsideWorkspace(
  workspaceAbs: string,
  candidateAbs: string,
): boolean {
  const root = path.resolve(workspaceAbs);
  const abs = path.resolve(candidateAbs);
  const rel = path.relative(root, abs);
  if (rel === "") {
    return true;
  }
  // Outside or different drive: relative starts with .. or is absolute
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}
