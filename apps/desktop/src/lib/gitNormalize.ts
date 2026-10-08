/**
 * Defensive normalizers for bridge `git_*` cli replies. `cli_result.data` is
 * `unknown` on the wire; these coerce it into the gitTypes shapes so widgets
 * never branch on missing fields. Pure: no store, no bridge.
 */

import type {
  GitCommitResult,
  GitDiffFile,
  GitDiffMode,
  GitDiffResult,
  GitFileKind,
  GitPrPreflight,
  GitPrResult,
  GitPushResult,
  GitStatus,
  GitStatusFile,
} from "./gitTypes";

/** Kinds the bridge may send; anything else maps to "unknown". */
const KNOWN_KINDS: ReadonlySet<string> = new Set<GitFileKind>([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "untracked",
  "conflicted",
  "unmerged",
]);

/**
 * View an unknown value as a plain record.
 * @param v Any value.
 * @returns The object, or an empty record for non-objects / arrays.
 */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * @param v Any value.
 * @returns v when it is a string, else "".
 */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * @param v Any value.
 * @returns A finite, non-negative integer (0 otherwise).
 */
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

/**
 * @param v Any value.
 * @returns A known kind, or "unknown".
 */
function kind(v: unknown): GitFileKind {
  const s = str(v);
  return KNOWN_KINDS.has(s) ? (s as GitFileKind) : "unknown";
}

/**
 * Normalize one `git_status` row; rows without a path are dropped by the caller.
 * @param raw Wire row.
 * @returns Typed row.
 */
function statusFile(raw: unknown): GitStatusFile {
  const r = asRecord(raw);
  const origPath = str(r.origPath);
  return {
    path: str(r.path),
    ...(origPath ? { origPath } : {}),
    index: str(r.index) || ".",
    worktree: str(r.worktree) || ".",
    kind: kind(r.kind),
  };
}

/**
 * Normalize a `git_status` reply.
 * @param data `cli_result.data`.
 * @returns Status; a malformed payload reads as "not a repo".
 */
export function normalizeGitStatus(data: unknown): GitStatus {
  const r = asRecord(data);
  const files = Array.isArray(r.files) ? r.files.map(statusFile) : [];
  return {
    isRepo: r.isRepo === true,
    root: str(r.root),
    branch: str(r.branch),
    detached: r.detached === true,
    head: str(r.head),
    initial: r.initial === true,
    upstream: str(r.upstream),
    ahead: count(r.ahead),
    behind: count(r.behind),
    files: files.filter((f) => f.path !== ""),
    truncated: r.truncated === true,
  };
}

/**
 * Normalize one `git_diff` row.
 * @param raw Wire row.
 * @returns Typed row.
 */
function diffFile(raw: unknown): GitDiffFile {
  const r = asRecord(raw);
  const origPath = str(r.origPath);
  const oldMode = str(r.oldMode);
  const newMode = str(r.newMode);
  return {
    path: str(r.path),
    ...(origPath ? { origPath } : {}),
    status: kind(r.status),
    untracked: r.untracked === true,
    added: count(r.added),
    removed: count(r.removed),
    binary: r.binary === true,
    ...(oldMode ? { oldMode } : {}),
    ...(newMode ? { newMode } : {}),
    patch: str(r.patch),
    tooLarge: r.tooLarge === true,
    omitted: r.omitted === true,
  };
}

/**
 * Normalize a `git_diff` reply.
 * @param data `cli_result.data`.
 * @returns Diff; a malformed payload reads as "not a repo".
 */
export function normalizeGitDiff(data: unknown): GitDiffResult {
  const r = asRecord(data);
  const mode: GitDiffMode = r.mode === "merge-base" ? "merge-base" : "head";
  const files = Array.isArray(r.files) ? r.files.map(diffFile) : [];
  return {
    isRepo: r.isRepo === true,
    root: str(r.root),
    mode,
    base: str(r.base),
    baseCommit: str(r.baseCommit),
    files: files.filter((f) => f.path !== ""),
    added: count(r.added),
    removed: count(r.removed),
    truncated: r.truncated === true,
  };
}

/**
 * Normalize a `git_commit` reply.
 * @param data `cli_result.data`.
 * @returns Commit summary.
 */
export function normalizeGitCommit(data: unknown): GitCommitResult {
  const r = asRecord(data);
  return { commit: str(r.commit), summary: str(r.summary), branch: str(r.branch) };
}

/**
 * Normalize a `git_push` reply.
 * @param data `cli_result.data`.
 * @returns Push summary.
 */
export function normalizeGitPush(data: unknown): GitPushResult {
  const r = asRecord(data);
  return {
    remote: str(r.remote),
    branch: str(r.branch),
    upstream: str(r.upstream),
    setUpstream: r.setUpstream === true,
    output: str(r.output),
  };
}

/**
 * Normalize a `git_pr_preflight` reply.
 * @param data `cli_result.data`.
 * @returns Preflight snapshot.
 */
export function normalizeGitPrPreflight(data: unknown): GitPrPreflight {
  const r = asRecord(data);
  return {
    ghAvailable: r.ghAvailable === true,
    ghAuthenticated: r.ghAuthenticated === true,
    ghMessage: str(r.ghMessage),
    branch: str(r.branch),
    upstream: str(r.upstream),
    ahead: count(r.ahead),
    defaultBase: str(r.defaultBase),
    bases: Array.isArray(r.bases)
      ? r.bases.filter((b): b is string => typeof b === "string" && b !== "")
      : [],
  };
}

/**
 * Normalize a `git_pr_create` reply.
 * @param data `cli_result.data`.
 * @returns PR URL + existing flag.
 */
export function normalizeGitPr(data: unknown): GitPrResult {
  const r = asRecord(data);
  return { url: str(r.url), existing: r.existing === true };
}
