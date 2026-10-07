/**
 * New chat draft helpers for newSessionAction: pick (and persist) the
 * workspace the draft opens in, and build the blank draft snapshot.
 * No bridge calls — the real session is created on first send.
 */

import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import { withCachedSlashCatalog } from "@/lib/slashCatalog";
import {
  loadWorkspacePrefs,
  rememberAndActivateWorkspace,
  saveWorkspacePrefs,
  setActiveWorkspacePrefs,
} from "@/lib/workspacePrefs";

/**
 * Resolve the New chat workspace and write the choice to workspace prefs.
 * Explicit `cwd` (including "") wins; otherwise prefs decide, falling back
 * to the open session's folder only when prefs name no active workspace.
 * @param cwd Caller override; undefined means "use prefs / session".
 * @param sessionWorkspace Workspace of the session currently on the canvas.
 * @returns Trimmed workspace path, or "" for no project. Prefs are left
 *   untouched when the result is "" only because nothing was known.
 */
export function adoptDraftWorkspace(
  cwd: string | undefined,
  sessionWorkspace: string,
): string {
  const prefs = loadWorkspacePrefs();
  // Explicit arg (including "") wins. Otherwise prefer prefs (noProject → "")
  // so bridge default cwd on session.workspace cannot hijack New chat.
  let workspace: string;
  if (cwd !== undefined) {
    workspace = cwd.trim();
  } else if (prefs.noProject) {
    workspace = "";
  } else {
    workspace = prefs.activeWorkspace.trim() || sessionWorkspace.trim();
  }
  if (workspace) {
    saveWorkspacePrefs(rememberAndActivateWorkspace(prefs, workspace));
  } else if (cwd !== undefined || prefs.noProject) {
    // Explicit no-project (caller or prefs) — keep the flag sticky.
    saveWorkspacePrefs(setActiveWorkspacePrefs(prefs, ""));
  }
  return workspace;
}

/**
 * Blank draft snapshot (empty id) that keeps the previous mode and slash
 * catalog. Handshake is deferred until first send; `/` must still list
 * compact / skills immediately.
 * @param prev Session currently on the canvas (mode + commands source).
 * @param workspace Workspace from adoptDraftWorkspace.
 * @returns Fresh SessionState; `prev` is not modified.
 */
export function buildDraftSession(
  prev: SessionState,
  workspace: string,
): SessionState {
  return withCachedSlashCatalog({
    ...createSessionState({
      id: "",
      workspace,
      mode: prev.mode,
    }),
    availableCommands: prev.availableCommands,
  });
}
