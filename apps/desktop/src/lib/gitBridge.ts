/**
 * Typed calls for the bridge `git_*` cli commands. Each takes a runner (the
 * live bridge's cli channel, or a fake in tests) plus the workspace cwd, and
 * resolves to a normalized payload or throws the bridge's error text
 * verbatim (auth failures, hook output, gh messages). Pure over the runner.
 */

import {
  normalizeGitCommit,
  normalizeGitDiff,
  normalizeGitPr,
  normalizeGitPrPreflight,
  normalizeGitPush,
  normalizeGitStatus,
} from "./gitNormalize";
import type {
  GitCommitResult,
  GitDiffMode,
  GitDiffResult,
  GitPrPreflight,
  GitPrResult,
  GitPushResult,
  GitStatus,
} from "./gitTypes";

/** Envelope returned by the cli channel. */
export type GitCliReply = { ok: boolean; data?: unknown; error?: string };

/**
 * Runs one cli command against an explicit cwd. Implementations must resolve
 * (never reject) with `ok: false` + error on transport failures.
 */
export type GitCliRunner = (
  command: string,
  args: Record<string, unknown> | undefined,
  cwd: string,
) => Promise<GitCliReply>;

/**
 * Run a command and unwrap its data, throwing the bridge error on failure.
 * @param run Runner.
 * @param command Command id.
 * @param args Args bag.
 * @param cwd Workspace.
 * @returns `data` of a successful reply.
 */
async function call(
  run: GitCliRunner,
  command: string,
  args: Record<string, unknown> | undefined,
  cwd: string,
): Promise<unknown> {
  const reply = await run(command, args, cwd);
  if (!reply.ok) {
    throw new Error(reply.error?.trim() || `${command} failed`);
  }
  return reply.data;
}

/**
 * Branch + dirty-file snapshot.
 * @param run Runner.
 * @param cwd Session workspace.
 * @returns Status (`isRepo: false` outside a repo).
 */
export async function fetchGitStatus(run: GitCliRunner, cwd: string): Promise<GitStatus> {
  return normalizeGitStatus(await call(run, "git_status", undefined, cwd));
}

/** Options for {@link fetchGitDiff}. */
export type GitDiffOptions = {
  /** head (uncommitted) or merge-base (whole branch). */
  mode: GitDiffMode;
  /** Base ref for merge-base mode; omit for the default branch. */
  base?: string;
  /** Limit to these repo-relative paths (both sides of a rename). */
  paths?: string[];
};

/**
 * Working-tree diff with per-file full-context patches.
 * @param run Runner.
 * @param cwd Session workspace.
 * @param opts Mode / base / path filter.
 * @returns Diff.
 */
export async function fetchGitDiff(
  run: GitCliRunner,
  cwd: string,
  opts: GitDiffOptions,
): Promise<GitDiffResult> {
  const args: Record<string, unknown> = { mode: opts.mode };
  if (opts.base) {
    args.base = opts.base;
  }
  if (opts.paths && opts.paths.length > 0) {
    args.paths = opts.paths;
  }
  return normalizeGitDiff(await call(run, "git_diff", args, cwd));
}

/**
 * Commit selected paths (or everything).
 * @param run Runner.
 * @param cwd Session workspace.
 * @param req message + paths (from commitPathsForSelection) or all.
 * @returns New commit summary.
 */
export async function runGitCommit(
  run: GitCliRunner,
  cwd: string,
  req: { message: string; paths?: string[]; all?: boolean },
): Promise<GitCommitResult> {
  return normalizeGitCommit(await call(run, "git_commit", req, cwd));
}

/**
 * Push (publishing the branch on first push).
 * @param run Runner.
 * @param cwd Session workspace.
 * @returns Push summary.
 */
export async function runGitPush(run: GitCliRunner, cwd: string): Promise<GitPushResult> {
  return normalizeGitPush(await call(run, "git_push", undefined, cwd));
}

/**
 * gh availability / auth + base suggestions for the PR dialog.
 * @param run Runner.
 * @param cwd Session workspace.
 * @returns Preflight snapshot.
 */
export async function fetchGitPrPreflight(
  run: GitCliRunner,
  cwd: string,
): Promise<GitPrPreflight> {
  return normalizeGitPrPreflight(await call(run, "git_pr_preflight", undefined, cwd));
}

/**
 * Create a pull request through gh.
 * @param run Runner.
 * @param cwd Session workspace.
 * @param req Title / body / base / draft.
 * @returns PR URL (existing PR URL when one is already open).
 */
export async function runGitPrCreate(
  run: GitCliRunner,
  cwd: string,
  req: { title: string; body: string; base: string; draft: boolean },
): Promise<GitPrResult> {
  return normalizeGitPr(await call(run, "git_pr_create", req, cwd));
}
