/**
 * Pure helpers for irreversible action confirmation (J-05).
 * UI must call these before delete/rewind/worktree-rm/memory-clear.
 */

/** Irreversible action kinds that require secondary confirm. */
export type IrreversibleKind =
  | "session_delete"
  | "rewind"
  | "worktree_rm"
  | "memory_clear"
  | "share_upload";

export type ConfirmPrompt = {
  /** Irreversible action this prompt describes. */
  kind: IrreversibleKind;
  /** Short question; does not embed the target name (that lives in `subject`). */
  title: string;
  /**
   * Named target shown as a chip under the title (session name, worktree
   * path). Omitted when the action has no distinct object.
   */
  subject?: string;
  /** Consequence lines rendered as paragraphs under the chip. */
  details: string[];
  /** Primary action label (Delete / Rewind / …). */
  confirmLabel: string;
  /** Dismiss label. */
  cancelLabel: string;
};

/**
 * Tidy a named confirm target for the subject chip.
 * Trims, unwraps one matching quote pair, and strips leftover markdown
 * fence ticks that leak from session titles (e.g. a trailing ```).
 * @param raw Session title, worktree path, or other label; empty/undefined → "".
 * @returns Display string; empty when there is nothing useful to show.
 */
export function formatConfirmSubject(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  const pairs: Array<[string, string]> = [
    ["“", "”"],
    ['"', '"'],
    ["'", "'"],
    ["‘", "’"],
  ];
  let value = trimmed;
  for (const [open, close] of pairs) {
    if (
      value.startsWith(open) &&
      value.endsWith(close) &&
      value.length > open.length + close.length
    ) {
      value = value.slice(open.length, value.length - close.length).trim();
      break;
    }
  }
  return value.replace(/^`{1,3}/, "").replace(/`{1,3}$/, "").trim();
}

/**
 * Build a confirm prompt for an irreversible op.
 * Title stays short; `ctx.label` becomes `subject` so the dialog can
 * truncate a long session name instead of wrapping it inside the heading.
 * @param kind Action kind.
 * @param ctx Optional context (session title, path, dirty git).
 */
export function buildConfirmPrompt(
  kind: IrreversibleKind,
  ctx: {
    label?: string;
    dirtyGit?: boolean;
    uploadHost?: string;
  } = {},
): ConfirmPrompt {
  const subject = formatConfirmSubject(ctx.label);
  switch (kind) {
    case "session_delete":
      return {
        kind,
        title: "Delete session?",
        subject: subject || undefined,
        details: [
          "This permanently removes the session from grok history. This cannot be undone.",
        ],
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      };
    case "rewind":
      return {
        kind,
        title: "Rewind conversation and files?",
        details: [
          "Rewind rolls back real files on disk to the selected turn.",
          ctx.dirtyGit
            ? "Uncommitted git changes will be lost."
            : "Workspace files may be overwritten.",
          "Timeline after the rewind point will be discarded.",
        ],
        confirmLabel: "Rewind",
        cancelLabel: "Cancel",
      };
    case "worktree_rm":
      return {
        kind,
        title: "Remove worktree?",
        subject: subject || undefined,
        details: [
          "The worktree directory will be deleted.",
          "Use dry-run first if you are unsure.",
        ],
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
      };
    case "memory_clear":
      return {
        kind,
        title: "Clear memory?",
        details: [
          "Stored cross-session memory will be wiped for the selected scope.",
          "This cannot be undone.",
        ],
        confirmLabel: "Clear",
        cancelLabel: "Cancel",
      };
    case "share_upload":
      return {
        kind,
        title: "Share conversation?",
        details: [
          `Content will be uploaded to ${ctx.uploadHost ?? "code.grok.com"}.`,
          "Cancel to avoid any network request.",
        ],
        confirmLabel: "Share",
        cancelLabel: "Cancel",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Whether an action is irreversible and must show secondary confirm.
 * @param kind Candidate action.
 */
export function requiresSecondaryConfirm(
  kind: string,
): kind is IrreversibleKind {
  return (
    kind === "session_delete" ||
    kind === "rewind" ||
    kind === "worktree_rm" ||
    kind === "memory_clear" ||
    kind === "share_upload"
  );
}
