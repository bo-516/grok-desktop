/**
 * New-chat worktree option state.
 * Lives next to the composer so name keystrokes never enter the session
 * store. The pending start request is a module slot that forceNew peeks.
 */

import { useEffect, useState } from "react";
import { useSessionStore } from "@/store/sessionStore";
import {
  buildWorktreeRequest,
  parseWorkspaceGit,
  projectPrefsKey,
  worktreeTokenError,
  type WorkspaceGitInfo,
} from "@/lib/worktreeChat";
import {
  loadWorktreeChatDefault,
  saveWorktreeChatDefault,
} from "@/lib/worktreeChatCatalog";
import {
  clearPendingWorktreeStart,
  setPendingWorktreeStart,
} from "@/lib/worktreeChatPending";

/** What {@link WorktreeChatOptionView} needs, plus visibility. */
export type WorktreeChatOptionModel = {
  /** False hides the whole block (not a draft, not a repo, or bridge down). */
  visible: boolean;
  /** Checkbox. Remembered per project. */
  enabled: boolean;
  /** Optional name. */
  name: string;
  /** Optional base ref. */
  refValue: string;
  /** Current branch, used as the ref placeholder. */
  branchPlaceholder: string;
  /** Name error. Empty when the token is safe. */
  nameError: string;
  /** Ref error. Empty when the token is safe. */
  refError: string;
  /**
   * Toggle and remember the checkbox.
   * @param next Next checked state.
   */
  onEnabledChange: (next: boolean) => void;
  /**
   * Update the name. Does not touch the session store.
   * @param next Input value.
   */
  onNameChange: (next: string) => void;
  /**
   * Update the base ref. Does not touch the session store.
   * @param next Input value.
   */
  onRefChange: (next: string) => void;
};

/**
 * Drive the new-chat worktree option for the selected project.
 * Hidden unless this is a draft (`localDraft` or empty session id), the
 * bridge is live, the workspace is non-empty, and `workspace_git` says
 * it is a git repo. The pending request is set only while visible, enabled,
 * and both tokens are valid — including `{}` when the fields are empty.
 * @returns Model for the view. `visible` false still returns stable handlers.
 */
export function useWorktreeChatOption(): WorktreeChatOptionModel {
  const sessionId = useSessionStore((s) => s.session.id);
  const localDraft = useSessionStore((s) => s.localDraft);
  const workspace = useSessionStore((s) => s.session.workspace);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const runCli = useSessionStore((s) => s.runCli);
  const workspaceKey = projectPrefsKey(workspace);
  const [prefsKey, setPrefsKey] = useState(workspaceKey);
  const [enabled, setEnabled] = useState(
    () => loadWorktreeChatDefault(workspaceKey)?.enabled ?? false,
  );
  const [name, setName] = useState(
    () => loadWorktreeChatDefault(workspaceKey)?.name ?? "",
  );
  const [refValue, setRefValue] = useState(
    () => loadWorktreeChatDefault(workspaceKey)?.ref ?? "",
  );
  const [git, setGit] = useState<WorkspaceGitInfo | null>(null);

  // Switching projects reloads that project's default before paint effects
  // so a save cannot clobber the previous project's stored checkbox.
  if (prefsKey !== workspaceKey) {
    const saved = loadWorktreeChatDefault(workspaceKey);
    setPrefsKey(workspaceKey);
    setEnabled(saved?.enabled ?? false);
    setName(saved?.name ?? "");
    setRefValue(saved?.ref ?? "");
  }

  const isDraft = localDraft || !sessionId.trim();
  const live = connectionMode === "live-bridge";

  useEffect(() => {
    if (!isDraft || !live || !workspace.trim()) {
      setGit(null);
      return;
    }
    let cancelled = false;
    void runCli("workspace_git", { path: workspace }).then((result) => {
      if (cancelled) {
        return;
      }
      setGit(result.ok ? parseWorkspaceGit(result.data) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isDraft, live, workspace, runCli]);

  useEffect(() => {
    if (!workspaceKey || prefsKey !== workspaceKey) {
      return;
    }
    saveWorktreeChatDefault(workspaceKey, { enabled, name, ref: refValue });
  }, [workspaceKey, prefsKey, enabled, name, refValue]);

  const visible = isDraft && live && Boolean(workspace.trim()) && git?.isRepo === true;
  const nameError = worktreeTokenError("Name", name);
  const refError = worktreeTokenError("Base ref", refValue);

  useEffect(() => {
    if (!visible || !enabled || nameError || refError) {
      clearPendingWorktreeStart();
      return;
    }
    setPendingWorktreeStart(buildWorktreeRequest(name, refValue));
    return () => {
      clearPendingWorktreeStart();
    };
  }, [visible, enabled, name, refValue, nameError, refError]);

  return {
    visible,
    enabled,
    name,
    refValue,
    branchPlaceholder: git?.branch || "HEAD",
    nameError,
    refError,
    onEnabledChange: setEnabled,
    onNameChange: setName,
    onRefChange: setRefValue,
  };
}
