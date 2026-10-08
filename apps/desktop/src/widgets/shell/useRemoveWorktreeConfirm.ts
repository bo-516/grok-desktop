/**
 * Open the remove-worktree confirm after a dirty check.
 * Kept out of useAppShellWidget so that file stays under the line budget.
 * Does not call `worktree_rm`. App does that after the user confirms a
 * clean tree. A dirty tree, a non-repo, or a failed probe sets `blocked`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  worktreeRemovalDecision,
  type WorktreeRemoveTarget,
} from "@/lib/worktreeChat";
import type { ShellConfirm } from "./shellConfirm";

/** `runCli` from the session store. Failures arrive as `ok: false`. */
type RunCli = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

/**
 * Build the confirm opener the shell returns as `requestRemoveWorktree`.
 * A second call replaces any open confirm with the new probe result.
 * @param runCli Live CLI channel. `workspace_git` reads `args.path`.
 * A missing bridge rejects or returns `ok: false`; both block removal.
 * @param setConfirm Shell confirm setter. Replaces any open confirm.
 * @returns Async handler. The promise resolves when the dialog is open.
 */
export function useRemoveWorktreeConfirm(
  runCli: RunCli,
  setConfirm: Dispatch<SetStateAction<ShellConfirm | null>>,
): (target: WorktreeRemoveTarget) => Promise<void> {
  return useCallback(
    async (target: WorktreeRemoveTarget) => {
      /** Dirty-check envelope. A down bridge arrives as ok: false. */
      const probe = await runCli("workspace_git", { path: target.path });
      /** Blocked when the tree is dirty, not a repo, or the check failed. */
      const decision = worktreeRemovalDecision(probe);
      setConfirm({
        kind: "worktree_rm",
        sessionId: target.sessionId,
        rmName: target.rmName,
        label: target.label,
        blocked: decision.blocked,
        reason: decision.reason,
      });
    },
    [runCli, setConfirm],
  );
}
