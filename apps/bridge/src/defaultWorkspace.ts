/**
 * Default agent workspace when the user has not picked a project.
 * Dev (monorepo checkout): the repository root so chats sit next to the code.
 * Production (packaged / no source tree): <Documents>/Grok on every OS.
 * BRIDGE_CWD always wins when set.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Leaf folder under the user's Documents directory in production. */
export const PRODUCT_WORKSPACE_FOLDER = "Grok";

/** Monorepo marker used by the shell and both bridges to detect a checkout. */
export const REPO_MARKER = path.join("apps", "bridge", "src", "server.ts");

/**
 * Walk upward from `startDir` looking for the grok-desktop monorepo.
 * @param startDir Absolute or relative origin (file or directory). Empty uses cwd.
 * @returns Absolute repo root, or null when no checkout is nearby.
 */
export function findRepoRoot(startDir = ""): string | null {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, REPO_MARKER))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * OS user Documents directory. Same leaf name on macOS / Windows / Linux
 * (`Documents`). `XDG_DOCUMENTS_DIR` wins when set (Linux user-dirs).
 * @param env Env bag; omit to read `process.env`. Missing HOME/USERPROFILE
 *   yields a `Documents` path under an empty prefix (still joined, never throws).
 * @returns Absolute-looking Documents path for the current platform.
 */
export function userDocumentsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_DOCUMENTS_DIR?.trim();
  if (xdg) {
    return path.resolve(xdg);
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || "";
  return path.join(home, "Documents");
}

/**
 * Production no-project / default workspace: `<Documents>/Grok`.
 * @param env Env bag for home / XDG override. Wrong HOME points at the
 *   wrong folder; callers should pass a real home in tests.
 * @returns Absolute path; directory may not exist yet.
 */
export function productionWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(userDocumentsDir(env), PRODUCT_WORKSPACE_FOLDER);
}

/**
 * Create `dir` (and parents) so the agent process has a real cwd.
 * @param dir Target workspace. Empty is a no-op and returned as-is.
 * @returns `dir` unchanged; mkdir failures are ignored (spawn will surface them).
 */
export function ensureWorkspaceDir(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) {
    return dir;
  }
  try {
    mkdirSync(trimmed, { recursive: true });
  } catch {
    /* spawn / first write reports the real error */
  }
  return trimmed;
}

/**
 * Resolve the default agent workspace.
 * Order: `BRIDGE_CWD` → nearby monorepo root (dev) → `<Documents>/Grok` (prod).
 * @param opts.startDir Walk origin for repo detection (pass `__dirname` from
 *   the bridge entry so cwd outside the tree still finds the checkout).
 * @param opts.env Env bag; omit to read `process.env`. Empty `BRIDGE_CWD`
 *   is treated as unset.
 * @returns Absolute workspace path. Missing args fall through the same order
 *   rather than throwing.
 */
export function resolveDefaultWorkspaceCwd(opts?: {
  startDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = opts?.env ?? process.env;
  const override = env.BRIDGE_CWD?.trim();
  if (override) {
    return path.resolve(override);
  }
  const repo = findRepoRoot(opts?.startDir);
  if (repo) {
    return repo;
  }
  return productionWorkspaceDir(env);
}
