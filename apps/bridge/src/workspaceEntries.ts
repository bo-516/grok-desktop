/**
 * `@` completion index for the real workspace.
 * Reads only the bridge current cwd; does not connect mock or offline fixtures.
 * Results are relative paths only to avoid leaking locations outside the workspace.
 * Optional `ignored` is a UX hint only — never used as a filter.
 */

import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Workspace target insertable in the input; directories and files can both be
 * handled by grok-build's `@` resolver.
 * `ignored` is true when git check-ignore says so; undefined when unknown
 * (non-git tree, missing git, or check-ignore failure) — UI must show no badge.
 */
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
  ignored?: boolean;
};

/**
 * Directories skipped by the walk.
 *
 * The test is "generated or vendored", never "gitignored". `.gitignore` is
 * deliberately not consulted: a repo may ignore authored content it still
 * wants to talk about — `docs/` here is exactly that case — and dropping those
 * paths would make `@docs/…` unmentionable for no benefit. What actually hurts
 * is walking machine-written trees like node_modules, so those are named here
 * explicitly. Add a name only when nothing inside it was written by a human.
 */
const GENERATED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

/** Default walk bounds: cover a typical source tree without blocking input on large repos. */
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 400;
/**
 * Ceiling on directory entries *inspected* per request. Separate from
 * maxEntries so a query whose matches sort late in the tree (`docs/` after
 * `apps/`) is not starved by unrelated files filling the result budget first.
 */
const DEFAULT_MAX_SCANNED = 20000;

/**
 * Read and rank mentionable files/directories in the current workspace by query.
 * @param workspace Real workspace already selected by the bridge; returns an empty array if missing or unreadable instead of reading other directories.
 * @param query Incomplete relative-path fragment after `@`; empty string returns the first path-sorted batch.
 * @param limits Testable depth/count/scan bounds; callers still own performance if values are too large.
 * @returns At most `maxEntries` matching relative paths; excludes hidden entries, generated directories, and symlinks.
 */
export async function listWorkspaceEntries(
  workspace: string,
  query: string,
  limits?: { maxDepth?: number; maxEntries?: number; maxScanned?: number },
): Promise<WorkspaceEntry[]> {
  const root = path.resolve(workspace);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const maxDepth = limits?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = limits?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxScanned = limits?.maxScanned ?? DEFAULT_MAX_SCANNED;
  /** Only query matches are kept, so late-sorting directories still fit. */
  const matches: Array<{ entry: WorkspaceEntry; score: number }> = [];
  let scanned = 0;

  await walkDirectory(root, "", 0);

  const ranked = matches
    .sort(
      (left, right) =>
        left.score - right.score || left.entry.path.localeCompare(right.entry.path),
    )
    .slice(0, maxEntries)
    .map((candidate) => candidate.entry);

  // Annotate only the returned batch — never the whole tree. Failure is silent.
  return annotateIgnoredFlags(root, ranked);

  /**
   * Recursively read a directory already verified to be under root.
   * @param absolutePath Absolute directory path to read.
   * @param relativePath Workspace-relative path returned to the browser.
   * @param depth Current depth; at maxDepth keep the directory itself but do not read children.
   * @returns No value; unreadable subtrees are skipped only.
   */
  async function walkDirectory(
    absolutePath: string,
    relativePath: string,
    depth: number,
  ): Promise<void> {
    const children = await readDirectorySafely(absolutePath);
    const sortedChildren = children.sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const child of sortedChildren) {
      if (scanned >= maxScanned || isResultBudgetSpent()) {return;}
      scanned += 1;
      const childPath = relativePath
        ? `${relativePath}/${child.name}`
        : child.name;
      const childAbsolutePath = path.join(absolutePath, child.name);
      const hidden = child.name.startsWith(".");

      if (hidden || child.isSymbolicLink()) {continue;}
      if (child.isDirectory()) {
        if (GENERATED_DIRECTORY_NAMES.has(child.name)) {continue;}
        collectIfMatching({ path: childPath, kind: "directory" });
        // Recurse even when the directory itself does not match: `docs` may
        // miss the query while `docs/design/brief.md` is the wanted hit.
        if (depth < maxDepth) {
          await walkDirectory(childAbsolutePath, childPath, depth + 1);
        }
        continue;
      }
      if (child.isFile()) {collectIfMatching({ path: childPath, kind: "file" });}
    }
  }

  /**
   * Keep an entry when it scores against the query.
   * @param entry Candidate already cleared by the hidden / generated filters.
   * @returns No value; non-matching entries are dropped so the result budget
   *   is spent on things the user can actually pick.
   */
  function collectIfMatching(entry: WorkspaceEntry): void {
    const score = scoreWorkspaceEntry(entry, normalizedQuery);
    if (score === Number.POSITIVE_INFINITY) {return;}
    matches.push({ entry, score });
  }

  /**
   * Whether the walk can stop early.
   * @returns true only for the empty query, where every entry ties on score and
   *   the first `maxEntries` in walk order are as good as any other batch. A
   *   real query must keep walking — its matches can sort anywhere in the tree.
   */
  function isResultBudgetSpent(): boolean {
    return !normalizedQuery && matches.length >= maxEntries;
  }
}

/**
 * Score a completion candidate for ranking.
 * @param entry Workspace entry.
 * @param query Lowercased query; empty means all candidates share the same tier.
 * @returns Lower is better; Infinity when unmatched so the caller can filter.
 */
function scoreWorkspaceEntry(entry: WorkspaceEntry, query: string): number {
  const normalizedPath = entry.path.toLocaleLowerCase();
  const normalizedName = normalizedPath.split("/").at(-1) ?? normalizedPath;

  if (!query) {return 3;}
  if (normalizedName.startsWith(query)) {return 0;}
  if (normalizedPath.startsWith(query)) {return 1;}
  if (normalizedPath.includes(query)) {return 2;}
  return Number.POSITIVE_INFINITY;
}

/**
 * Fault-tolerant directory read so permission changes do not fail the whole `@` request.
 * @param absolutePath Absolute path inside the workspace, built only by walkDirectory.
 * @returns Dirent array; empty when unreadable, deleted, or not a directory.
 */
async function readDirectorySafely(
  absolutePath: string,
): Promise<Dirent[]> {
  try {
    return await readdir(absolutePath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Batch-annotate entries with git check-ignore status.
 * Uses `git check-ignore --stdin -z` once for the result set only.
 * On any failure (no git, not a repo, non-zero unexpected), leaves `ignored`
 * undefined so the menu never filters or hides entries because of a badge.
 * @param workspaceAbs Absolute workspace root.
 * @param entries Ranked entries about to be returned.
 * @returns Same entries with optional ignored flags; order preserved.
 */
export async function annotateIgnoredFlags(
  workspaceAbs: string,
  entries: WorkspaceEntry[],
): Promise<WorkspaceEntry[]> {
  if (entries.length === 0) {
    return entries;
  }

  const ignoredSet = await runGitCheckIgnore(
    workspaceAbs,
    entries.map((e) => e.path),
  );
  if (ignoredSet === null) {
    // Unknown: strip any accidental ignored fields so UI shows no badge.
    return entries.map(({ path: p, kind }) => ({ path: p, kind }));
  }

  return entries.map((entry) => ({
    ...entry,
    ignored: ignoredSet.has(entry.path),
  }));
}

/**
 * Run git check-ignore --stdin -z --no-index for a path list.
 *
 * `--no-index` is required, not incidental. Without it git consults the index
 * and calls an already-tracked path "not ignored", because .gitignore has no
 * effect on tracked files. This repo is exactly that case: `docs/` is ignored
 * yet four files under it were committed before the rule existed, so the plain
 * check reports `docs` as not ignored and the badge disappears from the very
 * directory it exists for. The badge answers "does this match a .gitignore
 * pattern" — which is also what the ripgrep-based search tools inside
 * grok-build act on, since they do not read the index either.
 *
 * @param workspaceAbs Absolute workspace root (cwd for git).
 * @param paths Workspace-relative paths to test.
 * @returns Set of paths that are ignored, or null when status is unknown.
 */
function runGitCheckIgnore(
  workspaceAbs: string,
  paths: string[],
): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Set<string> | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let child;
    try {
      // Same shape grok-build uses: check-ignore --stdin -z (NUL-delimited).
      // Exit 0 = some ignored, 1 = none ignored, 128 = not a git repo / fatal.
      child = spawn("git", ["check-ignore", "--stdin", "-z", "--no-index"], {
        cwd: workspaceAbs,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch {
      finish(null);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        finish(null);
        return;
      }
      const raw = Buffer.concat(stdoutChunks).toString("utf8");
      const ignored = new Set(
        raw
          .split("\0")
          .map((p) => p.trim())
          .filter(Boolean),
      );
      finish(ignored);
    });

    try {
      child.stdin.write(`${paths.join("\0")}\0`);
      child.stdin.end();
    } catch {
      finish(null);
    }
  });
}
