/**
 * Worktree-chat helpers: start request, rail grouping key, and the dirty
 * check that refuses `worktree_rm`.
 * Catalog stamping and localStorage live in worktreeChatCatalog.ts.
 * No React and no bridge I/O — callers pass CLI results in.
 */

import {
  buildConfirmPrompt,
  type ConfirmPrompt,
} from "./confirmAction";

/**
 * Identity returned by session start and stored on a catalog row.
 * `sourceRepo` is the project the rail groups under. `path` is the
 * checkout the agent uses. Missing `id` means `worktree rm` uses `path`.
 */
export type WorktreeInfo = {
  /** Worktree directory. */
  path: string;
  /** Checked-out branch, or "HEAD" when detached or unnamed. */
  branch: string;
  /** Repository this worktree belongs to. */
  sourceRepo: string;
  /** Requested name or grok label. Omitted when unknown. */
  name?: string;
  /** Grok worktree id. Omitted when list/show did not identify the row. */
  id?: string;
};

/**
 * Optional `worktree` object on a session start frame.
 * An empty object still creates a worktree (CLI defaults: generated name,
 * HEAD plus uncommitted changes). Null in the pending slot means "do not
 * create" and is not this type.
 */
export type WorktreeStartRequest = {
  /** Optional `grok worktree create` name. Omitted when blank. */
  name?: string;
  /** Optional `--ref`. Omitted when blank. */
  ref?: string;
};

/** Per-project checkbox memory. Empty name and ref mean "use CLI defaults". */
export type WorktreeChatDefault = {
  /** True when new chats in this project start in a worktree. */
  enabled: boolean;
  /** Optional worktree name. Empty lets grok name it. */
  name: string;
  /** Optional base ref. Empty bases on HEAD plus uncommitted changes. */
  ref: string;
};

/**
 * What the rail asks the shell to confirm before `worktree_rm`.
 * `rmName` is the grok id when known, otherwise the directory path.
 */
export type WorktreeRemoveTarget = {
  /** Catalog session whose process should be closed before rm. */
  sessionId: string;
  /** Checkout probed for uncommitted changes. */
  path: string;
  /** Argument to `worktree_rm` (`id` or `path`). */
  rmName: string;
  /** Chip text in the confirm dialog. */
  label: string;
};

/**
 * `workspace_git` payload. `isRepo` false is a successful answer.
 * `dirty` true (or a failed probe) must refuse removal.
 */
export type WorkspaceGitInfo = {
  /** False when the path is not inside a git work tree. */
  isRepo: boolean;
  /** Branch name, or empty when not a repo. */
  branch: string;
  /** This checkout's root. */
  toplevel: string;
  /** Main repository. Equal to toplevel when this is not a worktree. */
  sourceRepo: string;
  /** True when `git status --porcelain` is non-empty. */
  dirty: boolean;
  /** True when sourceRepo is a different directory from toplevel. */
  worktree: boolean;
  /** Grok id when list/show identified this checkout. */
  worktreeId: string;
  /** Grok label when known. */
  worktreeName: string;
  /** Toplevel when this checkout is a worktree, else empty. */
  worktreePath: string;
};

/** Cached probe. `sourceRepo` null means "checked, not a separate worktree". */
export type WorktreeSourceCacheEntry = {
  /** Source repo, or null after a negative probe. */
  sourceRepo: string | null;
  /** Branch when this path is a worktree. */
  branch?: string;
  /** Label when known. */
  name?: string;
  /** Grok id when known. */
  id?: string;
  /** Worktree directory when known. */
  path?: string;
};

/**
 * Compare paths for grouping. macOS `/tmp` and `/var` are the same
 * directories as `/private/tmp` and `/private/var`. Other paths, including
 * `/Users`, are left unchanged so rail prefs keep their existing keys.
 * @param path Workspace or source repo. Empty stays empty.
 * @returns Path safe to use as a project group key.
 */
export function canonicalProjectPath(path: string): string {
  if (path === "/tmp" || path.startsWith("/tmp/")) {
    return `/private${path}`;
  }
  if (path === "/var" || path.startsWith("/var/")) {
    return `/private${path}`;
  }
  return path;
}

/**
 * Prefs key for one project. Trailing slashes are removed so `/repo` and
 * `/repo/` share a default. The filesystem root stays `/`.
 * @param path Selected project path. Blank stays blank.
 * @returns Key for {@link loadWorktreeChatDefault}.
 */
export function projectPrefsKey(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed || path.trim();
}

/**
 * Rail label: `name · branch` when the name is a different token, otherwise
 * the branch, otherwise the name. Empty when both are missing — the row
 * then shows no mark.
 * @param info Catalog or pool worktree. Undefined yields "".
 * @returns Single-line label. Never includes a newline.
 */
export function formatWorktreeIndicator(
  info: { name?: string; branch?: string } | undefined,
): string {
  if (!info) {
    return "";
  }
  const name = info.name?.trim() ?? "";
  const branch = info.branch?.trim() ?? "";
  if (name && branch && name !== branch) {
    return `${name} · ${branch}`;
  }
  return branch || name;
}

/**
 * Group key for one catalog row. A known source repo wins over the
 * worktree directory so parallel chats stay under the project that owns
 * them. Paths are canonicalized only for `/tmp` and `/var`.
 * @param workspace Session workspace (often the worktree path).
 * @param sourceRepo Source repo when the row or the probe cache has one.
 * @returns Key passed to the project grouper. Empty when both are empty.
 */
export function projectGroupKey(workspace: string, sourceRepo?: string): string {
  const source = sourceRepo?.trim() ?? "";
  return canonicalProjectPath(source || workspace);
}

/**
 * Reject tokens the CLI would read as flags or as extra lines.
 * Empty is valid (the field is omitted). A leading "-" or a newline is not.
 * @param label Human name used in the message ("Name" / "Base ref").
 * @param value Raw input. Trimmed before the check.
 * @returns Error text, or "" when the token may be sent.
 */
export function worktreeTokenError(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("-")) {
    return `${label} must not start with "-"`;
  }
  if (/[\r\n]/.test(trimmed)) {
    return `${label} must be a single line`;
  }
  return "";
}

/**
 * Build the start-frame object from the option fields.
 * Blank name and ref are omitted. Both blank still returns `{}`, which
 * asks the bridge to create with CLI defaults. Invalid tokens are the
 * caller's job to withhold — this function does not validate.
 * @param name Optional worktree name.
 * @param ref Optional base ref.
 * @returns Request to store as the pending start. Never null.
 */
export function buildWorktreeRequest(
  name: string,
  ref: string,
): WorktreeStartRequest {
  const request: WorktreeStartRequest = {};
  const trimmedName = name.trim();
  const trimmedRef = ref.trim();
  if (trimmedName) {
    request.name = trimmedName;
  }
  if (trimmedRef) {
    request.ref = trimmedRef;
  }
  return request;
}

/**
 * Read `workspace_git` data. A missing or non-object payload is null so
 * the caller can refuse a removal instead of assuming the tree is clean.
 * `isRepo: false` is a real answer and returns an object.
 * @param data `cli_result.data`. Not the envelope.
 * @returns Parsed info, or null when the shape is not the bridge payload.
 */
export function parseWorkspaceGit(data: unknown): WorkspaceGitInfo | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const row = data as Record<string, unknown>;
  if (typeof row.isRepo !== "boolean") {
    return null;
  }
  return {
    isRepo: row.isRepo,
    branch: typeof row.branch === "string" ? row.branch : "",
    toplevel: typeof row.toplevel === "string" ? row.toplevel : "",
    sourceRepo: typeof row.sourceRepo === "string" ? row.sourceRepo : "",
    dirty: row.dirty === true,
    worktree: row.worktree === true,
    worktreeId: typeof row.worktreeId === "string" ? row.worktreeId : "",
    worktreeName: typeof row.worktreeName === "string" ? row.worktreeName : "",
    worktreePath: typeof row.worktreePath === "string" ? row.worktreePath : "",
  };
}

/**
 * True only when `worktree_rm` exited 0. The CLI channel returns ok for a
 * non-zero grok exit and puts the code on `data.code`. A missing code,
 * a transport error, or any other code is a failure — the directory stays.
 * @param result Envelope from `runCli("worktree_rm", …)`.
 * @returns True when the worktree was removed.
 */
export function worktreeRmSucceeded(result: {
  ok: boolean;
  data?: unknown;
}): boolean {
  if (!result.ok || !result.data || typeof result.data !== "object") {
    return false;
  }
  return (result.data as { code?: unknown }).code === 0;
}

/**
 * Result of {@link worktreeRemovalDecision}.
 * `blocked` true hides the confirm button. An empty `reason` means the
 * tree looked clean.
 */
export type WorktreeRemovalDecision = {
  /** True when `worktree_rm` must not be offered. */
  blocked: boolean;
  /** Dialog sentence. Empty when the checkout is a clean git repo. */
  reason: string;
};

/**
 * Whether the remove-worktree confirm may offer the destructive button.
 * A failed probe, a payload that is not `workspace_git`, a non-repo, or
 * a dirty tree is blocked. A clean repo is not blocked and has an empty
 * reason — the dialog still requires a click. `worktree_rm` is not called
 * from here.
 * @param probe Envelope from `runCli("workspace_git", { path })`.
 * `ok: false` or a non-object `data` is a failed check, not "clean".
 * @returns `blocked` and the sentence shown when removal is refused.
 */
export function worktreeRemovalDecision(probe: {
  ok: boolean;
  data?: unknown;
}): WorktreeRemovalDecision {
  /** Parsed checkout. Null when the probe failed or the payload is not workspace_git. */
  const git = probe.ok ? parseWorkspaceGit(probe.data) : null;
  if (!probe.ok || !git) {
    return {
      blocked: true,
      reason:
        "Could not check for uncommitted changes. The worktree was not removed.",
    };
  }
  if (!git.isRepo) {
    return {
      blocked: true,
      reason:
        "This folder is not a git checkout. The worktree was not removed.",
    };
  }
  if (git.dirty) {
    return {
      blocked: true,
      reason:
        "This worktree has uncommitted changes. Commit or discard them before removing it.",
    };
  }
  return { blocked: false, reason: "" };
}

/**
 * Confirm copy for removing a worktree.
 * A blocked checkout keeps the standard title and replaces the deletion
 * warning with the refusal reason, so the dialog can hide the confirm
 * button. A clean tree uses the shared `worktree_rm` prompt.
 * @param label Chip text. Empty still produces a prompt.
 * @param blocked True when the checkout must not be removed.
 * @param reason Refusal sentence. Ignored when `blocked` is false.
 * A missing reason with `blocked` true still returns a prompt whose
 * details array holds an empty string — the caller should pass the
 * decision reason.
 * @returns Prompt fields. `kind` stays `worktree_rm` either way.
 */
export function worktreeRemovePrompt(
  label: string,
  blocked: boolean,
  reason: string,
): ConfirmPrompt {
  if (!blocked) {
    return buildConfirmPrompt("worktree_rm", { label });
  }
  return {
    kind: "worktree_rm",
    title: "Remove worktree?",
    subject: label,
    details: [reason],
    confirmLabel: "Remove",
    cancelLabel: "Close",
  };
}
