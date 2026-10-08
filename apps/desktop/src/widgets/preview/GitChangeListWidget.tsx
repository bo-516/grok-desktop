/**
 * Stateful git change list for the preview drawer: assembles the diff hook,
 * list chrome state, the git action bar and per-file bodies into
 * GitChangeListView. Shown for changeset targets when the workspace is a
 * git repository (otherwise the drawer keeps the tool-card change list).
 */

import { useCallback, useMemo } from "react";
import { titleFromSessionState } from "@grok-desktop/acp-core";
import type { GitDiffFile } from "@/lib/gitTypes";
import { toPathDisplay } from "@/lib/pathDisplay";
import { usePreviewStore } from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import { GitActionBarWidget } from "@/widgets/git";
import { GitChangeFileWidget } from "./GitChangeFileWidget";
import { GitChangeListView, GitChangeScopeView } from "./GitChangeListView";
import { useDiffListChrome } from "./useDiffListChrome";
import { useGitChangeListWidget, type GitChangeTarget } from "./useGitChangeListWidget";

export type GitChangeListWidgetProps = {
  /** Session- or turn-scoped changeset target. */
  target: GitChangeTarget;
};

/**
 * Join a repo root and a repo-relative path.
 * @param root Absolute root ("" keeps the relative path).
 * @param path Repo-relative slash path.
 * @returns Absolute path in the root's separator style.
 */
function joinRoot(root: string, path: string): string {
  if (!root) {
    return path;
  }
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${sep === "\\" ? path.replace(/\//g, "\\") : path}`;
}

/**
 * Git change list with action bar.
 * @param props Changeset target.
 * @returns List view.
 */
export function GitChangeListWidget(props: GitChangeListWidgetProps) {
  const list = useGitChangeListWidget(props.target);
  const openPreview = usePreviewStore((s) => s.openPreview);
  /** Chat title for the PR prefill (live title wins, like the top nav). */
  const sessionTitle = useSessionStore((s) => titleFromSessionState(s.session));
  const paths = useMemo(() => list.files.map((f) => f.path), [list.files]);
  const chrome = useDiffListChrome(paths, list.files.length);
  const { root, cwd, attribution } = list;

  const displayFor = useCallback(
    (file: GitDiffFile) => toPathDisplay(joinRoot(root, file.path), cwd),
    [root, cwd],
  );
  const onOpenFile = useCallback(
    (absPath: string) => openPreview({ kind: "file", path: absPath }),
    [openPreview],
  );
  const renderBody = useCallback(
    (file: GitDiffFile) => (
      <GitChangeFileWidget
        file={file}
        absPath={joinRoot(root, file.path)}
        viewPrefs={chrome.viewPrefs}
        onViewPrefsChange={chrome.onPrefsReplace}
        onLoad={list.loadFile}
        onOpenFile={onOpenFile}
      />
    ),
    [root, chrome.viewPrefs, chrome.onPrefsReplace, list.loadFile, onOpenFile],
  );

  return (
    <GitChangeListView
      actionBar={
        <GitActionBarWidget
          cwd={cwd}
          sessionTitle={sessionTitle}
          extra={
            <GitChangeScopeView
              mode={list.mode}
              base={list.diff?.base ?? ""}
              turnFilter={list.turnFilter}
              onModeChange={list.setMode}
              onFilterChange={list.setFilterOn}
            />
          }
        />
      }
      files={list.files}
      totalFiles={list.diff?.files.length ?? 0}
      mode={list.mode}
      base={list.diff?.base ?? ""}
      loading={list.loading}
      error={list.error}
      truncated={list.diff?.truncated ?? false}
      turnFilter={list.turnFilter}
      attribution={attribution}
      displayFor={displayFor}
      collapsed={chrome.collapsed}
      allCollapsed={chrome.allCollapsed}
      viewPrefs={chrome.viewPrefs}
      chromeRef={chrome.chromeRef}
      summaryH={chrome.summaryH}
      onToggle={chrome.toggle}
      onCollapseAll={chrome.onCollapseAll}
      onExpandAll={chrome.onExpandAll}
      onPrefsPatch={chrome.onPrefsPatch}
      onModeChange={list.setMode}
      onFilterChange={list.setFilterOn}
      renderBody={renderBody}
    />
  );
}
