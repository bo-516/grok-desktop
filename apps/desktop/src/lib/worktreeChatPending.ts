/**
 * Pending "run in a new worktree" request for the next forceNew start.
 * The composer widget owns the fields and writes here. Session start peeks
 * without clearing, so a failed create can be retried while the draft
 * (and the widget) are still mounted. The widget clears this on unmount
 * and when the checkbox is off.
 */

import type { WorktreeStartRequest } from "./worktreeChat";

/**
 * Latest request. Null means the next new chat stays in the selected
 * checkout. `{}` means create with CLI defaults.
 */
let pending: WorktreeStartRequest | null = null;

/**
 * Replace the pending request. Pass null to send the next new chat in
 * the selected checkout. An empty object still creates a worktree.
 * @param request Request to attach to the next forceNew start, or null.
 */
export function setPendingWorktreeStart(
  request: WorktreeStartRequest | null,
): void {
  pending = request;
}

/**
 * Read the pending request without clearing it.
 * Undefined means "do not send a worktree field". An empty object is
 * returned as-is so the bridge creates with CLI defaults.
 * @returns The request, or undefined when the option is off.
 */
export function peekPendingWorktreeStart(): WorktreeStartRequest | undefined {
  return pending ?? undefined;
}

/**
 * Drop the pending request. Called when the option unmounts or is turned
 * off so a later new chat does not inherit a stale create.
 */
export function clearPendingWorktreeStart(): void {
  pending = null;
}
