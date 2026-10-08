/**
 * Confirm dialog kinds hosted by the shell (one active confirm).
 * The shell hook owns the value; App renders it. Worktree removal is
 * blocked when the checkout is dirty or the dirty check failed — the
 * dialog then offers only dismiss.
 */

/** Single active shell confirm, or the fields App needs to render one. */
export type ShellConfirm =
  | { kind: "session_delete"; id: string; title: string }
  | { kind: "rewind" }
  | {
      kind: "worktree_rm";
      /** Session whose process is closed before rm. The catalog row stays. */
      sessionId: string;
      /** Grok id, or the directory path when the id is unknown. */
      rmName: string;
      /** Chip text. */
      label: string;
      /**
       * True when the tree is dirty or the dirty check failed.
       * The dialog then offers only dismiss — rm is not called.
       */
      blocked: boolean;
      /** Why removal was refused. Empty when `blocked` is false. */
      reason: string;
    };
