/**
 * Path resolution and git-exclude helpers for managed user prompts.
 * Paths are derived only from GROK_HOME + project root (never from client args).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PromptEntry, PromptScope } from "./userPromptsFormat.js";

/** Managed file under global / project rules dirs. */
export const GLOBAL_FILE = "00-grok-desktop.md";
/** Project-local (user-only) file; must sort after GLOBAL_FILE (see T-ORD-02). */
export const PROJECT_LOCAL_FILE = "01-grok-desktop.local.md";
/** Git exclude pattern for project-local managed files. */
export const LOCAL_EXCLUDE_LINE = ".grok/rules/*.local.md";

/** One scope's on-disk state as read back by the bridge. */
export type PromptScopeState = {
  scope: PromptScope;
  /** Absolute path the bridge would write; present even when the file is absent. */
  path: string;
  /** false when the file does not exist yet. */
  exists: boolean;
  /**
   * true when the file exists but is NOT ours (no managed marker).
   * UI must render read-only and refuse set/clear for this scope.
   */
  foreign: boolean;
  entries: PromptEntry[];
  bytes: number;
};

/** Reply of prompts_get. */
export type PromptsSnapshot = {
  /** Resolved once per call so the UI can show it in the section header. */
  projectRoot: string | null;
  /** true when projectRoot is a git repo (drives the "会进 git" badge). */
  gitRepo: boolean;
  /** true when .git/info/exclude already hides *.local.md. */
  localExcluded: boolean;
  global: PromptScopeState;
  project: PromptScopeState;
  projectLocal: PromptScopeState;
};

/** Result of a successful set / clear / move side. */
export type PromptWriteResult = {
  scope: PromptScope;
  path: string;
  bytes: number;
  removed: boolean;
};

/**
 * Resolve grok home: GROK_HOME when set, else `<userHome>/.grok`.
 * Same env the child agent process inherits (env whitelist).
 */
export function resolveGrokHome(): string {
  const fromEnv = process.env.GROK_HOME?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(homedir(), ".grok");
}

/**
 * Resolve project root from cwd via `git rev-parse --show-toplevel`.
 * On failure (non-git), returns cleaned cwd and gitRepo=false.
 * @param cwd Workspace path from the cli frame (session workspace).
 */
export function resolveProjectRoot(cwd: string): {
  projectRoot: string;
  gitRepo: boolean;
} {
  const abs = path.resolve(cwd || process.cwd());
  try {
    const out = execFileSync(
      "git",
      ["-C", abs, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (out) {
      return { projectRoot: path.resolve(out), gitRepo: true };
    }
  } catch {
    // non-git
  }
  return { projectRoot: abs, gitRepo: false };
}

/**
 * Absolute path for a managed scope file.
 * @param scope Layer id.
 * @param grokHome Resolved GROK_HOME / ~/.grok.
 * @param projectRoot Repo root or cwd.
 */
export function scopePath(
  scope: PromptScope,
  grokHome: string,
  projectRoot: string,
): string {
  if (scope === "global") {
    return path.join(grokHome, "rules", GLOBAL_FILE);
  }
  if (scope === "project") {
    return path.join(projectRoot, ".grok", "rules", GLOBAL_FILE);
  }
  return path.join(projectRoot, ".grok", "rules", PROJECT_LOCAL_FILE);
}

/**
 * Whether `.git/info/exclude` already contains the local-rules ignore line.
 * @param projectRoot Repo root.
 */
export function isLocalExcluded(projectRoot: string): boolean {
  const excludePath = path.join(projectRoot, ".git", "info", "exclude");
  if (!existsSync(excludePath)) {
    return false;
  }
  try {
    const body = readFileSync(excludePath, "utf8");
    return body.split(/\r?\n/).some((l) => l.trim() === LOCAL_EXCLUDE_LINE);
  } catch {
    return false;
  }
}

/**
 * Idempotently ensure `.git/info/exclude` hides `*.local.md` under `.grok/rules`.
 * Never touches `.gitignore`. No-op when exclude path does not exist (non-git).
 * @param projectRoot Repo root.
 * @returns true when the line is present after the call (or already was).
 */
export function ensureLocalExclude(projectRoot: string): boolean {
  const excludePath = path.join(projectRoot, ".git", "info", "exclude");
  if (!existsSync(excludePath)) {
    return false;
  }
  let body = "";
  try {
    body = readFileSync(excludePath, "utf8");
  } catch {
    return false;
  }
  if (body.split(/\r?\n/).some((l) => l.trim() === LOCAL_EXCLUDE_LINE)) {
    return true;
  }
  const needsNl = body.length > 0 && !body.endsWith("\n");
  const next = `${body}${needsNl ? "\n" : ""}${LOCAL_EXCLUDE_LINE}\n`;
  try {
    writeFileSync(excludePath, next, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param scope Candidate scope string.
 */
export function assertScope(scope: string): asserts scope is PromptScope {
  if (scope !== "global" && scope !== "project" && scope !== "projectLocal") {
    throw new Error(`unknown prompt scope: ${scope}`);
  }
}
