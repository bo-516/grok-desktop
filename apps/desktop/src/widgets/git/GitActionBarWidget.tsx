/**
 * Stateful git action bar: wires useGitActionBarWidget into the bar view and
 * mounts the commit / PR dialogs while they are open.
 */

import type { ReactNode } from "react";
import { GitActionBarView } from "./GitActionBarView";
import { GitCommitDialogWidget } from "./GitCommitDialogWidget";
import { GitPrDialogWidget } from "./GitPrDialogWidget";
import { useGitActionBarWidget } from "./useGitActionBarWidget";

export type GitActionBarWidgetProps = {
  /** Session workspace the actions run in. */
  cwd: string;
  /** Chat title (PR title prefill). */
  sessionTitle: string;
  /** Extra controls row rendered inside the bar (scope toggle, filters). */
  extra?: ReactNode;
};

/**
 * Commit / Push / Create PR bar with its dialogs.
 * @param props Workspace, PR title source and optional extra row.
 * @returns Bar plus the open dialog, if any.
 */
export function GitActionBarWidget(props: GitActionBarWidgetProps) {
  const bar = useGitActionBarWidget(props.cwd);
  return (
    <>
      <GitActionBarView
        status={bar.status}
        loading={bar.loading}
        error={bar.error}
        gates={bar.gates}
        busy={bar.busy}
        notice={bar.notice}
        extra={props.extra}
        onCommit={bar.openCommit}
        onPush={() => {
          void bar.onPush();
        }}
        onPr={bar.openPr}
        onRefresh={bar.onRefresh}
        onDismissNotice={bar.dismissNotice}
      />
      {bar.dialog === "commit" && bar.status ? (
        <GitCommitDialogWidget
          branch={bar.status.branch}
          files={bar.status.files}
          busy={bar.busy === "commit"}
          onCommit={bar.onCommit}
          onClose={bar.closeDialog}
        />
      ) : null}
      {bar.dialog === "pr" && bar.status ? (
        <GitPrDialogWidget
          cwd={props.cwd}
          sessionTitle={props.sessionTitle}
          branch={bar.status.branch}
          busy={bar.busy === "pr"}
          onCreate={bar.onCreatePr}
          onOpenUrl={bar.onOpenUrl}
          onClose={bar.closeDialog}
        />
      ) : null}
    </>
  );
}
