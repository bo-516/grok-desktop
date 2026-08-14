/**
 * Session-rail project list preview / expand math and the prefs mutators
 * that persist "Show more" / "Show less".
 *
 * Preview shows the first {@link PROJECT_SESSION_PREVIEW} rows. After
 * expand, every session is in the list but only
 * {@link PROJECT_SESSION_EXPANDED_CAP} stay in view — extra rows scroll
 * inside the group. The viewport is short on purpose: a 25-row window
 * filled the rail and read as a dense dump.
 */

import {
  isPreviewExpanded,
  normalizeWorkspaceKey,
  type SessionRailPrefs,
} from "@/lib/sessionRailPrefs";

/** Rows shown under a project before "Show more". */
export const PROJECT_SESSION_PREVIEW = 5;

/**
 * After "Show more", how many session rows stay in view at once.
 * Further rows scroll inside the group (`project-group-session-list-scroll`).
 * Kept well under a full rail-height so folder + list + "Show less" remain
 * on screen; 25 packed rows was rejected as too dense.
 */
export const PROJECT_SESSION_EXPANDED_CAP = 8;

/** Derived chrome for one project / no-project session list. */
export type ProjectGroupListModel<T> = {
  /** Rows to render (empty when the folder is collapsed). */
  visible: T[];
  /** List is clamped to the preview cap — render "Show N more". */
  showMore: boolean;
  /** List is past the preview cap — render "Show less". */
  showLess: boolean;
  /** Expanded list is longer than the viewport cap — wrap in a scrollport. */
  overflow: boolean;
  /** Hidden count for the "Show N more" label. 0 when not previewing. */
  remaining: number;
};

/**
 * Decide which rows render and which more/less chrome to show.
 * Collapsed folders hide every row. Preview slices to
 * {@link PROJECT_SESSION_PREVIEW}. Expanded keeps the full ordered list
 * (caller applies the 8-row scrollport when `overflow` is true).
 * @param sessions Already-ordered rows for this workspace.
 * @param collapsed Folder-only (no rows, no more/less).
 * @param previewExpanded User clicked "Show more" (sticky via rail prefs).
 * @returns Visible slice plus show-more / show-less / overflow flags.
 */
export function projectGroupListModel<T>(
  sessions: T[],
  collapsed: boolean,
  previewExpanded: boolean,
): ProjectGroupListModel<T> {
  /** Full group length — preview remaining and overflow compare against this. */
  const total = sessions.length;
  if (collapsed) {
    return {
      visible: [],
      showMore: false,
      showLess: false,
      overflow: false,
      remaining: 0,
    };
  }
  /** Long enough that preview/less chrome can apply. */
  const overPreview = total > PROJECT_SESSION_PREVIEW;
  if (!previewExpanded && overPreview) {
    return {
      visible: sessions.slice(0, PROJECT_SESSION_PREVIEW),
      showMore: true,
      showLess: false,
      overflow: false,
      remaining: total - PROJECT_SESSION_PREVIEW,
    };
  }
  return {
    visible: sessions,
    showMore: false,
    showLess: overPreview && previewExpanded,
    overflow: total > PROJECT_SESSION_EXPANDED_CAP,
    remaining: 0,
  };
}

/**
 * Persist "Show more" for a workspace (full list past the preview cap).
 * No-op when already expanded. Does not open a collapsed folder.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @returns New prefs with preview-expand set updated.
 */
export function expandWorkspacePreview(
  prefs: SessionRailPrefs,
  workspace: string,
): SessionRailPrefs {
  return withPreviewExpanded(prefs, workspace, true);
}

/**
 * Persist "Show less" for a workspace (back to the preview cap).
 * No-op when not expanded. Folder collapse stays unchanged.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @returns New prefs with preview-expand cleared for this workspace.
 */
export function collapseWorkspacePreview(
  prefs: SessionRailPrefs,
  workspace: string,
): SessionRailPrefs {
  return withPreviewExpanded(prefs, workspace, false);
}

/**
 * Set preview-expand membership for one workspace.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @param expanded True keeps the full list; false returns to preview.
 * @returns Same prefs object when the flag is already correct.
 */
function withPreviewExpanded(
  prefs: SessionRailPrefs,
  workspace: string,
  expanded: boolean,
): SessionRailPrefs {
  /** Trailing-slash-normalized membership key. */
  const key = normalizeWorkspaceKey(workspace);
  if (isPreviewExpanded(prefs, key) === expanded) {
    return prefs;
  }
  /** Existing expand list without this workspace (order of others kept). */
  const rest = prefs.previewExpandedWorkspaces.filter(
    (w) => normalizeWorkspaceKey(w) !== key,
  );
  return {
    ...prefs,
    previewExpandedWorkspaces: expanded ? [...rest, key] : rest,
  };
}
