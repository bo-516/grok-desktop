/**
 * Pure view-model helpers for the git chrome: top-nav chip label, action
 * gates (enabled + the reason shown when disabled), commit selection and PR
 * title defaults, and the refresh-trigger predicates. No store, no bridge.
 */

import type { SessionStatus } from "@grok-desktop/acp-core";
import type { GitDiffFile, GitStatus, GitStatusFile } from "./gitTypes";

/** Top-nav branch chip model. */
export type GitChipModel = {
  /** False when the workspace is not a repo (or status is unknown). */
  visible: boolean;
  /** Branch name, or "detached @abc1234". */
  branch: string;
  /** Changed-file count (0 hides the badge). */
  dirty: number;
  /** Tooltip: branch, changes and upstream drift. */
  title: string;
};

/**
 * Build the branch chip from a status snapshot.
 * @param status Snapshot, or null before the first load.
 * @returns Chip model; invisible when there is nothing to show.
 */
export function gitChipModel(status: GitStatus | null): GitChipModel {
  if (!status || !status.isRepo) {
    return { visible: false, branch: "", dirty: 0, title: "" };
  }
  const branch = status.detached
    ? `detached @${status.head.slice(0, 7)}`
    : status.branch || "(no branch)";
  const dirty = status.files.length;
  const parts = [branch];
  parts.push(
    dirty === 0
      ? "clean"
      : `${dirty}${status.truncated ? "+" : ""} changed file${dirty === 1 ? "" : "s"}`,
  );
  if (status.upstream) {
    parts.push(`↑${status.ahead} ↓${status.behind} vs ${status.upstream}`);
  } else if (!status.detached) {
    parts.push("not published");
  }
  return { visible: true, branch, dirty, title: parts.join(" · ") };
}

/** Enabled flag plus the explanation shown when it is not. */
export type GitActionGate = { enabled: boolean; reason: string };

/** Gates for the three panel actions. */
export type GitActionGates = {
  commit: GitActionGate;
  push: GitActionGate;
  pr: GitActionGate;
  /** "Publish" before the first push (sets upstream), else "Push". */
  pushLabel: string;
};

/**
 * Reason every action is blocked, or "" when per-action rules apply.
 * @param status Latest snapshot (null while loading).
 * @param opts connected / busy flags.
 * @returns Shared blocking reason.
 */
function sharedBlockReason(
  status: GitStatus | null,
  opts: { connected: boolean; busy: boolean },
): string {
  if (!opts.connected) {
    return "Bridge not connected";
  }
  if (!status) {
    return "Loading git status…";
  }
  if (!status.isRepo) {
    return "Not a git repository";
  }
  return opts.busy ? "Another git action is running" : "";
}

/**
 * @param status Repo snapshot.
 * @returns Why Commit is unavailable, or "".
 */
function commitBlockReason(status: GitStatus): string {
  if (status.files.length === 0) {
    return "No changes to commit";
  }
  if (status.files.some((f) => f.kind === "conflicted")) {
    return "Resolve merge conflicts before committing";
  }
  return "";
}

/**
 * @param status Repo snapshot.
 * @returns Why Push / Publish is unavailable, or "".
 */
function pushBlockReason(status: GitStatus): string {
  if (status.detached) {
    return "HEAD is detached — check out a branch to push";
  }
  if (status.initial) {
    return "No commits to push yet";
  }
  if (status.upstream && status.ahead === 0) {
    return `Up to date with ${status.upstream}`;
  }
  return "";
}

/**
 * @param status Repo snapshot.
 * @returns Why Create PR is unavailable, or "" (gh checks run in the dialog).
 */
function prBlockReason(status: GitStatus): string {
  if (status.detached) {
    return "HEAD is detached — check out a branch first";
  }
  if (!status.upstream) {
    return "Publish the branch before opening a pull request";
  }
  if (status.ahead > 0) {
    return `Push ${status.ahead} unpushed commit${status.ahead === 1 ? "" : "s"} first`;
  }
  return "";
}

/**
 * Turn a reason into a gate.
 * @param reason "" when enabled.
 * @returns Gate.
 */
function gate(reason: string): GitActionGate {
  return { enabled: reason === "", reason };
}

/**
 * Decide which git actions are available and why not.
 * @param status Latest snapshot (null while loading).
 * @param opts connected: bridge is live; busy: a git action is in flight.
 * @returns Per-action gates; reasons are user-facing sentences.
 */
export function gitActionGates(
  status: GitStatus | null,
  opts: { connected: boolean; busy: boolean },
): GitActionGates {
  const pushLabel = status?.upstream ? "Push" : "Publish";
  const blocked = sharedBlockReason(status, opts);
  if (blocked || !status) {
    const all = gate(blocked || "Loading git status…");
    return { commit: all, push: all, pr: all, pushLabel };
  }
  return {
    commit: gate(commitBlockReason(status)),
    push: gate(pushBlockReason(status)),
    pr: gate(prBlockReason(status)),
    pushLabel,
  };
}

/**
 * Expand a commit selection so a selected rename also commits its source.
 * @param files Changed files (status or diff rows).
 * @param selected Selected current paths.
 * @returns Paths for `git_commit.paths`, de-duplicated, in file order.
 */
export function commitPathsForSelection(
  files: ReadonlyArray<Pick<GitStatusFile | GitDiffFile, "path" | "origPath">>,
  selected: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const f of files) {
    if (!selected.has(f.path)) {
      continue;
    }
    push(f.path);
    if (f.origPath) {
      push(f.origPath);
    }
  }
  return out;
}

/** Longest PR title we prefill (GitHub allows more; long titles read badly). */
export const PR_TITLE_MAX = 120;

/**
 * Prefill a PR title from the session title, falling back to the branch.
 * Whitespace collapses to single spaces; overlong titles end with "…".
 * @param sessionTitle Display title of the chat ("" when untitled).
 * @param branch Current branch name.
 * @returns Title suggestion (may be "" when both inputs are empty).
 */
export function defaultPrTitle(sessionTitle: string, branch: string): string {
  const generic = /^(new chat|current chat)$/i;
  const fromSession = sessionTitle.replace(/\s+/g, " ").trim();
  const base = fromSession && !generic.test(fromSession) ? fromSession : branch.trim();
  return base.length > PR_TITLE_MAX ? `${base.slice(0, PR_TITLE_MAX - 1)}…` : base;
}

/** Statuses during which the agent may still be editing files. */
const BUSY_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "streaming",
  "waiting_permission",
]);

/**
 * A turn just settled: the agent stopped working, so the work tree is worth
 * re-reading (no tight polling while it runs).
 * @param prev Status before the update (null on first observation).
 * @param next Status now.
 * @returns True on a busy → idle/disconnected edge.
 */
export function isTurnSettleEdge(
  prev: SessionStatus | null,
  next: SessionStatus,
): boolean {
  return prev !== null && BUSY_STATUSES.has(prev) && !BUSY_STATUSES.has(next);
}

/** Minimum gap between focus-triggered refreshes. */
export const GIT_FOCUS_REFRESH_GAP_MS = 2_000;

/**
 * Throttle for window-focus refreshes (alt-tab storms).
 * @param lastAt Epoch ms of the previous refresh (0 = never).
 * @param now Current epoch ms.
 * @returns True when enough time has passed.
 */
export function focusRefreshDue(lastAt: number, now: number): boolean {
  return now - lastAt >= GIT_FOCUS_REFRESH_GAP_MS;
}
