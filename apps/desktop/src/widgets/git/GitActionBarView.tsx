/**
 * Stateless git action bar for the change panel: branch / upstream line,
 * Commit… / Push (Publish) / Create PR… buttons with the disabled reason as
 * tooltip and inline hint, a refresh control, an optional extra row (scope
 * toggle from the change list) and the last action's notice.
 */

import cs from "classnames";
import { GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { GitActionGate, GitActionGates } from "@/lib/gitPanelModel";
import type { GitStatus } from "@/lib/gitTypes";
import type { GitActionNotice, GitBusyAction } from "./useGitActionBarWidget";

export type GitActionBarViewProps = {
  /** Repo snapshot (null while loading). */
  status: GitStatus | null;
  /** Status refresh in flight. */
  loading: boolean;
  /** Last status error ("" / null when fine). */
  error: string | null;
  /** Per-action availability. */
  gates: GitActionGates;
  /** Running action. */
  busy: GitBusyAction;
  /** Last action result. */
  notice: GitActionNotice | null;
  /** Extra controls row (diff scope toggle, turn filter). */
  extra?: ReactNode;
  onCommit: () => void;
  onPush: () => void;
  onPr: () => void;
  onRefresh: () => void;
  onDismissNotice: () => void;
};

/**
 * Branch / upstream summary text.
 * @param status Snapshot.
 * @returns Short line such as "feat · ↑2 ↓0 origin/feat".
 */
function branchLine(status: GitStatus | null): string {
  if (!status) {
    return "Loading git status…";
  }
  if (!status.isRepo) {
    return "Not a git repository";
  }
  const name = status.detached ? `detached @${status.head.slice(0, 7)}` : status.branch;
  if (!status.upstream) {
    return status.detached ? name : `${name} · not published`;
  }
  return `${name} · ↑${status.ahead} ↓${status.behind} ${status.upstream}`;
}

/**
 * The first disabled reason worth surfacing inline (tooltips carry the rest).
 * @param gates Gates.
 * @returns Hint text or "".
 */
function inlineHint(gates: GitActionGates): string {
  const reasons = [gates.commit, gates.push, gates.pr]
    .filter((g: GitActionGate) => !g.enabled)
    .map((g) => g.reason);
  return reasons.length === 3 ? reasons[0] ?? "" : "";
}

/**
 * Action bar block above the change list.
 * @param props Status, gates, busy / notice and handlers.
 * @returns Bar element.
 */
export function GitActionBarView(props: GitActionBarViewProps) {
  const { gates, busy, notice } = props;
  const hint = props.error || inlineHint(gates);
  return (
    <div className="git-action-bar" data-kind="git-action-bar">
      <div className="git-action-row">
        <span className="git-branch-line" title={branchLine(props.status)}>
          <GitBranch size={13} strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">{branchLine(props.status)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Refresh git status"
          aria-label="Refresh git status"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          <RefreshCw className={cs({ "animate-spin": props.loading })} aria-hidden />
        </Button>
      </div>
      <div className="git-action-row">
        <Button size="sm" variant="outline" disabled={!gates.commit.enabled} title={gates.commit.reason || "Commit changes"} onClick={props.onCommit}>
          <GitCommitHorizontal aria-hidden />
          {busy === "commit" ? "Committing…" : "Commit…"}
        </Button>
        <Button size="sm" variant="outline" disabled={!gates.push.enabled} title={gates.push.reason || `${gates.pushLabel} the current branch`} onClick={props.onPush}>
          <Upload aria-hidden />
          {busy === "push" ? "Pushing…" : gates.pushLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={!gates.pr.enabled} title={gates.pr.reason || "Create a pull request with gh"} onClick={props.onPr}>
          <GitPullRequest aria-hidden />
          {busy === "pr" ? "Creating…" : "Create PR…"}
        </Button>
      </div>
      {props.extra}
      {hint ? <p className="git-notice">{hint}</p> : null}
      {notice ? (
        <div className={cs("git-notice git-notice-row", { "git-notice-error": notice.tone === "error" })} role="status">
          <span className="min-w-0 flex-1">{notice.text}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={props.onDismissNotice}>
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
