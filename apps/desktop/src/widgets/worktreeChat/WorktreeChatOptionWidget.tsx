/**
 * Stateful new-chat worktree option.
 * Returns null when the draft is not a live git workspace so the composer
 * dock does not reserve a gap.
 */

import { WorktreeChatOptionView } from "./WorktreeChatOptionView";
import { useWorktreeChatOption } from "./useWorktreeChatOption";

/**
 * Mount above the composer card. The hook probes `workspace_git` and
 * writes the pending start request. Hidden for existing chats, non-repos,
 * and while the bridge is down.
 * @returns The option view, or null when it does not apply.
 */
export function WorktreeChatOptionWidget() {
  const model = useWorktreeChatOption();
  if (!model.visible) {
    return null;
  }
  return (
    <WorktreeChatOptionView
      enabled={model.enabled}
      name={model.name}
      refValue={model.refValue}
      branchPlaceholder={model.branchPlaceholder}
      nameError={model.nameError}
      refError={model.refError}
      onEnabledChange={model.onEnabledChange}
      onNameChange={model.onNameChange}
      onRefChange={model.onRefChange}
    />
  );
}
