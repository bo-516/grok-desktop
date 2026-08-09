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
  kind: IrreversibleKind;
  /** Primary warning shown in the dialog title/body. */
  title: string;
  /** Detail lines (disk rollback, remote upload, etc.). */
  details: string[];
  /** Confirm button label. */
  confirmLabel: string;
  /** Cancel button label. */
  cancelLabel: string;
};

/**
 * Build a confirm prompt for an irreversible op.
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
  const label = ctx.label ?? "this item";
  switch (kind) {
    case "session_delete":
      return {
        kind,
        title: `Delete session “${label}”?`,
        details: [
          "This permanently removes the session from grok history.",
          "This cannot be undone.",
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
        title: `Remove worktree “${label}”?`,
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
 * Whether an action is irreversible and must show secondary confirm before bridge/CLI call.
 * @param kind Candidate action.
 */
export function requiresSecondaryConfirm(kind: string): kind is IrreversibleKind {
  return (
    kind === "session_delete" ||
    kind === "rewind" ||
    kind === "worktree_rm" ||
    kind === "memory_clear" ||
    kind === "share_upload"
  );
}
