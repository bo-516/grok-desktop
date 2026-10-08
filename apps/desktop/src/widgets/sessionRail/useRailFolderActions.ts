/**
 * Collapse and preview-expand handlers for session-rail project folders.
 * Split out of the rail hook so that file stays under the line cap.
 * Prefs are persisted by the caller's `commitRailPrefs`.
 */

import { useCallback } from "react";
import {
  collapseWorkspacePreview,
  expandWorkspacePreview,
} from "@/lib/sessionRailPreview";
import {
  toggleCollapsedWorkspace,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";

/**
 * Folder header actions. Each handler writes through `commitRailPrefs`.
 * @param commitRailPrefs Persisting prefs updater from the rail hook.
 * A stale closure is safe because the updater receives the latest prefs.
 * @returns Collapse, show-more, and show-less callbacks.
 */
export function useRailFolderActions(
  commitRailPrefs: (
    updater: (prev: SessionRailPrefs) => SessionRailPrefs,
  ) => void,
) {
  /**
   * Toggle collapse for a workspace group header click.
   * Persists so the folder does not re-expand on remount.
   * @param workspace Absolute path key for the group.
   */
  const onToggleCollapse = useCallback(
    (workspace: string) => {
      commitRailPrefs((prev) => toggleCollapsedWorkspace(prev, workspace));
    },
    [commitRailPrefs],
  );

  /**
   * Reveal sessions past the preview cap ("Show more").
   * Persisted until "Show less" or the folder is collapsed.
   * @param workspace Absolute path key for the group.
   */
  const onExpandPreview = useCallback(
    (workspace: string) => {
      commitRailPrefs((prev) => expandWorkspacePreview(prev, workspace));
    },
    [commitRailPrefs],
  );

  /**
   * Restore the preview cap ("Show less").
   * Persisted so remount does not re-open the full list.
   * @param workspace Absolute path key for the group.
   */
  const onCollapsePreview = useCallback(
    (workspace: string) => {
      commitRailPrefs((prev) => collapseWorkspacePreview(prev, workspace));
    },
    [commitRailPrefs],
  );

  return { onToggleCollapse, onExpandPreview, onCollapsePreview };
}
