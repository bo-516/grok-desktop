/**
 * `@` completion index for the real workspace.
 * Reads only the bridge current cwd; does not connect mock or offline fixtures.
 * Results are relative paths only to avoid leaking locations outside the workspace.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/** Workspace target insertable in the input; directories and files can both be handled by grok-build's `@` resolver. */
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
};

/** Generated directories excluded from interactive completion so node_modules and similar do not slow the real bridge. */
const IGNORED_DIRECTORY_NAMES = new Set([
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
 * Read and rank mentionable files/directories in the current workspace by query.
 * @param workspace Real workspace already selected by the bridge; returns an empty array if missing or unreadable instead of reading other directories.
 * @param query Incomplete relative-path fragment after `@`; empty string returns the first path-sorted batch.
 * @param limits Testable depth/count bounds; callers still own performance if values are too large.
 * @returns At most `maxEntries` relative paths; excludes hidden entries, generated directories, and symlinks.
 */
export async function listWorkspaceEntries(
  workspace: string,
  query: string,
  limits?: { maxDepth?: number; maxEntries?: number },
): Promise<WorkspaceEntry[]> {
  const root = path.resolve(workspace);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const maxDepth = limits?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = limits?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries: WorkspaceEntry[] = [];

  await walkDirectory(root, "", 0);

  return entries
    .map((entry) => ({ entry, score: scoreWorkspaceEntry(entry, normalizedQuery) }))
    .filter((candidate) => candidate.score !== Number.POSITIVE_INFINITY)
    .sort(
      (left, right) =>
        left.score - right.score || left.entry.path.localeCompare(right.entry.path),
    )
    .slice(0, maxEntries)
    .map((candidate) => candidate.entry);

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
      if (entries.length >= maxEntries) {return;}
      const childPath = relativePath
        ? `${relativePath}/${child.name}`
        : child.name;
      const childAbsolutePath = path.join(absolutePath, child.name);
      const hidden = child.name.startsWith(".");

      if (hidden || child.isSymbolicLink()) {continue;}
      if (child.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(child.name)) {continue;}
        entries.push({ path: childPath, kind: "directory" });
        if (depth < maxDepth && entries.length < maxEntries) {
          await walkDirectory(childAbsolutePath, childPath, depth + 1);
        }
        continue;
      }
      if (child.isFile()) {entries.push({ path: childPath, kind: "file" });}
      if (entries.length >= maxEntries) {return;}
    }
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
