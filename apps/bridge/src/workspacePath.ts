/**
 * Workspace path boundary helpers for reverse fs services.
 * Uses path.relative (not string prefix) so neighbor dirs like demo-evil cannot slip past.
 * Existing paths are realpath'd so in-workspace symlinks cannot escape the root (QA-REV-14).
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Whether a path.relative result leaves the workspace root.
 * Aligns with Go: only `..` and `..${sep}…` count as parent escapes (not `..foo`).
 * @param rel Relative path from root to candidate (path.relative output).
 * @returns true when the candidate is outside the root.
 */
export function isRelativeOutsideWorkspace(rel: string): boolean {
  if (rel === "") {
    return false;
  }
  if (path.isAbsolute(rel)) {
    return true;
  }
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
    return true;
  }
  return false;
}

/**
 * Whether abs is inside root (or is root itself) using lexical resolve only.
 * Callers that need symlink safety must use {@link resolveWorkspacePath}.
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
  return !isRelativeOutsideWorkspace(rel);
}

/**
 * Realpath an existing path; returns null when missing or unreadable.
 * @param abs Absolute path that may or may not exist.
 */
function tryRealpath(abs: string): string | null {
  try {
    if (!existsSync(abs)) {
      return null;
    }
    return realpathSync(abs);
  } catch {
    return null;
  }
}

/**
 * After lexical resolve, ensure the final path (or its nearest existing parent
 * still under the workspace) does not escape via symlinks.
 * Parents above the workspace root are never realpath'd (would reject valid
 * missing paths when the workspace itself is not yet on disk).
 * @param realRoot realpath of the workspace root when available.
 * @param absLexical Lexically resolved absolute path under realRoot.
 * @param raw Original client path (for error messages).
 * @returns Absolute path safe to open/write under the workspace.
 */
function enforceRealpathInside(
  realRoot: string,
  absLexical: string,
  raw: string,
): string {
  const realSelf = tryRealpath(absLexical);
  if (realSelf) {
    if (!isPathInsideWorkspace(realRoot, realSelf)) {
      throw new Error(`path outside workspace: ${raw}`);
    }
    return realSelf;
  }

  // New file / missing path: walk parents that stay inside the workspace only.
  let parent = path.dirname(absLexical);
  let cur = absLexical;
  while (parent !== cur && isPathInsideWorkspace(realRoot, parent)) {
    const realParent = tryRealpath(parent);
    if (realParent) {
      if (!isPathInsideWorkspace(realRoot, realParent)) {
        throw new Error(`path outside workspace: ${raw}`);
      }
      const relFromParent = path.relative(parent, absLexical);
      const finalAbs = path.resolve(realParent, relFromParent);
      if (!isPathInsideWorkspace(realRoot, finalAbs)) {
        throw new Error(`path outside workspace: ${raw}`);
      }
      return finalAbs;
    }
    cur = parent;
    parent = path.dirname(parent);
  }

  // Nothing on disk under the workspace — lexical containment is enough.
  if (!isPathInsideWorkspace(realRoot, absLexical)) {
    throw new Error(`path outside workspace: ${raw}`);
  }
  return absLexical;
}

/**
 * Resolve a client-supplied path under workspace and reject escapes.
 * Symlinks inside the workspace that point outside are rejected (QA-REV-14).
 * @param workspaceAbs Absolute workspace root (already resolved).
 * @param requested Relative or absolute path from the agent reverse request.
 * @returns Absolute path inside workspace (realpath when the target exists).
 * @throws When the resolved path leaves the workspace (including `..`, prefix-neighbor, symlink escape).
 */
export function resolveWorkspacePath(
  workspaceAbs: string,
  requested: string | undefined | null,
): string {
  const rootLexical = path.resolve(workspaceAbs);
  const realRoot = tryRealpath(rootLexical) ?? rootLexical;
  const raw = requested == null || requested === "" ? "." : String(requested);
  if (raw.includes("\0")) {
    throw new Error(`path outside workspace: ${raw}`);
  }
  /**
   * Absolute client paths are remapped through the real workspace root so
   * macOS `/var` vs `/private/var` (and similar aliasing) does not false-deny
   * a path that is inside the same workspace directory.
   */
  let absLexical: string;
  if (path.isAbsolute(raw)) {
    const absReq = path.resolve(raw);
    if (isPathInsideWorkspace(rootLexical, absReq)) {
      absLexical = path.resolve(realRoot, path.relative(rootLexical, absReq));
    } else if (isPathInsideWorkspace(realRoot, absReq)) {
      absLexical = absReq;
    } else {
      // Last chance: realpath the absolute request when it already exists.
      const realReq = tryRealpath(absReq);
      if (realReq && isPathInsideWorkspace(realRoot, realReq)) {
        return realReq;
      }
      throw new Error(`path outside workspace: ${raw}`);
    }
  } else {
    absLexical = path.resolve(realRoot, raw);
  }
  if (!isPathInsideWorkspace(realRoot, absLexical)) {
    throw new Error(`path outside workspace: ${raw}`);
  }
  return enforceRealpathInside(realRoot, absLexical, raw);
}
