/**
 * Git panel payload types — mirrors of the bridge `git_*` cli replies
 * (apps/bridge-go/internal/gitops). Paths are repo-relative with `/`
 * separators; `root` carries the absolute work-tree root.
 * Types only: normalization lives in gitNormalize.ts.
 */

/** Summary kind of one changed path (badge + commit dialog grouping). */
export type GitFileKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "conflicted"
  | "unmerged"
  | "unknown";

/** One changed path from `git_status`. */
export type GitStatusFile = {
  /** Current path (rename destination). */
  path: string;
  /** Rename / copy source; absent otherwise. */
  origPath?: string;
  /** Porcelain X column (staged); "." when unchanged. */
  index: string;
  /** Porcelain Y column (unstaged); "." when unchanged. */
  worktree: string;
  /** Summary kind. */
  kind: GitFileKind;
};

/** `git_status` reply: branch + dirty-file snapshot for one workspace. */
export type GitStatus = {
  /** False outside a work tree; every other field is then empty. */
  isRepo: boolean;
  /** Absolute work-tree root; "" when not a repo. */
  root: string;
  /** Checked-out branch; "" when detached or not a repo. */
  branch: string;
  /** HEAD points at a commit, not a branch. */
  detached: boolean;
  /** Full HEAD id; "" before the first commit. */
  head: string;
  /** No commits yet on this branch. */
  initial: boolean;
  /** Tracking ref such as "origin/feat"; "" when unset. */
  upstream: string;
  /** Local commits not on the upstream. */
  ahead: number;
  /** Upstream commits not merged locally. */
  behind: number;
  /** Changed paths incl. untracked. */
  files: GitStatusFile[];
  /** File list was capped by the bridge. */
  truncated: boolean;
};

/** Diff comparison scope. */
export type GitDiffMode = "head" | "merge-base";

/** One changed path from `git_diff`. */
export type GitDiffFile = {
  path: string;
  origPath?: string;
  /** Status from `git diff --raw` (untracked files report "added"). */
  status: GitFileKind;
  /** File was untracked before the diff folded it in. */
  untracked: boolean;
  added: number;
  removed: number;
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  /** Full-context unified diff section; "" when binary / tooLarge / omitted. */
  patch: string;
  /** Patch exceeded the per-file cap. */
  tooLarge: boolean;
  /** Aggregate budget ran out; re-request with `paths` to load it alone. */
  omitted: boolean;
};

/** `git_diff` reply. */
export type GitDiffResult = {
  isRepo: boolean;
  root: string;
  mode: GitDiffMode;
  /** "HEAD" or the base ref compared against (e.g. "origin/main"). */
  base: string;
  baseCommit: string;
  files: GitDiffFile[];
  added: number;
  removed: number;
  /** Untracked files were capped. */
  truncated: boolean;
};

/** `git_commit` reply. */
export type GitCommitResult = {
  commit: string;
  summary: string;
  branch: string;
};

/** `git_push` reply. */
export type GitPushResult = {
  remote: string;
  branch: string;
  upstream: string;
  setUpstream: boolean;
  output: string;
};

/** `git_pr_preflight` reply. */
export type GitPrPreflight = {
  ghAvailable: boolean;
  ghAuthenticated: boolean;
  /** gh's own explanation when missing / logged out; "" otherwise. */
  ghMessage: string;
  branch: string;
  upstream: string;
  ahead: number;
  /** Suggested base branch name ("" when none found). */
  defaultBase: string;
  /** Branch names on the remote for the base picker. */
  bases: string[];
};

/** `git_pr_create` reply. */
export type GitPrResult = {
  url: string;
  /** A PR for this branch already existed; url points at it. */
  existing: boolean;
};
