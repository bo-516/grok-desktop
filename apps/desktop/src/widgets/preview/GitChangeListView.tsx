/**
 * Stateless git change list: action-bar slot, scope / turn-filter controls,
 * sticky summary chrome and one collapsible section per changed file with
 * status badge, +/− counts and "Turn N" attribution chips. File bodies are
 * provided by the caller (renderBody) so this view stays presentation-only.
 */

import cs from "classnames";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { DiffViewPrefs } from "@/lib/diffViewPrefs";
import type { GitTurnRef } from "@/lib/gitAttribution";
import type { GitDiffFile, GitDiffMode } from "@/lib/gitTypes";
import type { PathDisplay } from "@/lib/pathDisplay";
import { GitStatusBadgeView } from "@/widgets/git";
import { DiffChangeListChrome } from "./DiffChangeListChrome";
import { DiffFileSectionView } from "./DiffFileSectionView";
import type { GitTurnFilter } from "./useGitChangeListWidget";

export type GitChangeListViewProps = {
  /** Action bar element (GitActionBarWidget) rendered first. */
  actionBar: ReactNode;
  /** Files to render (already filtered). */
  files: GitDiffFile[];
  /** Total files in the diff before the turn filter. */
  totalFiles: number;
  /** Diff scope and the base it compared with. */
  mode: GitDiffMode;
  base: string;
  /** Diff request in flight / last error. */
  loading: boolean;
  error: string;
  /** Untracked list capped by the bridge. */
  truncated: boolean;
  /** Turn filter (turn-scoped targets only). */
  turnFilter: GitTurnFilter | null;
  /** Path → turns that touched it. */
  attribution: Map<string, GitTurnRef[]>;
  /** Display parts per path. */
  displayFor: (file: GitDiffFile) => PathDisplay;
  /** Collapse state + prefs + measured strip (useDiffListChrome). */
  collapsed: ReadonlySet<string>;
  allCollapsed: boolean;
  viewPrefs: DiffViewPrefs;
  chromeRef: Ref<HTMLDivElement>;
  summaryH: number;
  onToggle: (path: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onPrefsPatch: (patch: Partial<DiffViewPrefs>) => void;
  onModeChange: (mode: GitDiffMode) => void;
  onFilterChange: (active: boolean) => void;
  /** Body for an expanded file. */
  renderBody: (file: GitDiffFile) => ReactNode;
  /** Review-comment tray pinned to the bottom (null / omitted → none). */
  reviewTray?: ReactNode;
};

/**
 * Scope toggle + turn filter row (goes inside the action bar).
 * @param props Mode, base, filter, handlers, and an optional turn action
 *   (the "Restore" trigger) shown after the filter pill for turn targets.
 * @returns Controls row.
 */
export function GitChangeScopeView(props: {
  mode: GitDiffMode;
  base: string;
  turnFilter: GitTurnFilter | null;
  onModeChange: (mode: GitDiffMode) => void;
  onFilterChange: (active: boolean) => void;
  turnAction?: ReactNode;
}) {
  const { mode, turnFilter } = props;
  const turnLabel = turnFilter && turnFilter.index > 0 ? `Turn ${turnFilter.index}` : "This turn";
  return (
    <div className="git-action-row">
      <div className="git-scope-toggle" role="group" aria-label="Compare against">
        <button type="button" className={cs("git-scope-btn", { "git-scope-btn-on": mode === "head" })} aria-pressed={mode === "head"} onClick={() => props.onModeChange("head")}>
          Uncommitted
        </button>
        <button type="button" className={cs("git-scope-btn", { "git-scope-btn-on": mode === "merge-base" })} aria-pressed={mode === "merge-base"} title="Everything on this branch since it forked from the base branch" onClick={() => props.onModeChange("merge-base")}>
          {mode === "merge-base" && props.base ? `Branch vs ${props.base}` : "Branch"}
        </button>
      </div>
      {turnFilter ? (
        <button type="button" className={cs("git-scope-btn", { "git-scope-btn-on": turnFilter.active })} aria-pressed={turnFilter.active} title="Only files this turn's tool calls touched" onClick={() => props.onFilterChange(!turnFilter.active)}>
          {turnFilter.active ? `${turnLabel} only` : `Show ${turnLabel} only`}
        </button>
      ) : null}
      {turnFilter ? props.turnAction : null}
    </div>
  );
}

/**
 * Meta cluster for one file head.
 * @param props File and its turn refs.
 * @returns Badge, counts and chips.
 */
function FileMeta(props: { file: GitDiffFile; turns: GitTurnRef[] }) {
  const { file, turns } = props;
  return (
    <>
      {turns.map((t) => (
        <span key={t.turnId} className="git-turn-chip" title={`Edited by the agent in turn ${t.index}`}>
          T{t.index}
        </span>
      ))}
      {file.binary ? <span>binary</span> : (
        <>
          <span className="preview-count-add">+{file.added}</span>
          <span className="preview-count-del">−{file.removed}</span>
        </>
      )}
      <GitStatusBadgeView kind={file.untracked ? "untracked" : file.status} />
    </>
  );
}

/**
 * Git-backed change list.
 * @param props Data, chrome state and handlers from GitChangeListWidget.
 * @returns Scrollable list.
 */
export function GitChangeListView(props: GitChangeListViewProps) {
  const { files } = props;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const scopeLabel = props.mode === "head" ? "vs HEAD" : `vs ${props.base || "base"}`;
  const style = { ["--preview-summary-h" as string]: `${props.summaryH}px` } as CSSProperties;
  return (
    <div className="preview-change-list" data-kind="git-change-list" style={style}>
      {props.actionBar}
      {props.error ? <div className="preview-error">{props.error}</div> : null}
      <DiffChangeListChrome
        chromeRef={props.chromeRef}
        summary={
          <>
            {files.length === props.totalFiles ? "" : `${files.length} of `}
            {props.totalFiles} file{props.totalFiles === 1 ? "" : "s"} {scopeLabel}{" "}
            <span className="preview-count-add">+{added}</span>{" "}
            <span className="preview-count-del">−{removed}</span>
            {props.truncated ? " · list capped" : ""}
            {props.loading ? " · refreshing…" : ""}
          </>
        }
        allCollapsed={props.allCollapsed}
        onCollapseAll={props.onCollapseAll}
        onExpandAll={props.onExpandAll}
        viewPrefs={props.viewPrefs}
        onViewPrefsChange={props.onPrefsPatch}
      />
      {files.length === 0 && !props.loading ? (
        <div className="preview-empty">
          {props.totalFiles > 0 ? "None of this turn's files have uncommitted changes." : "Working tree clean — no changes."}
        </div>
      ) : null}
      {files.map((file) => {
        const expanded = !props.collapsed.has(file.path);
        return (
          <DiffFileSectionView
            key={file.path}
            path={file.path}
            pathDisplay={props.displayFor(file)}
            expanded={expanded}
            onToggle={() => props.onToggle(file.path)}
            meta={<FileMeta file={file} turns={props.attribution.get(file.path) ?? []} />}
          >
            {expanded ? props.renderBody(file) : null}
          </DiffFileSectionView>
        );
      })}
      {props.reviewTray}
    </div>
  );
}
