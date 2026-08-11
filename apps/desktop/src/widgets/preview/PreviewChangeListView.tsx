/**
 * Stateless changeset file list + per-file structured diffs (vertical flow).
 */

import type { ChangeSet } from "@/lib/changeSet";
import { buildFileDiff } from "@/lib/diffCore";
import { PreviewDiffWidget } from "./PreviewDiffWidget";

export type PreviewChangeListViewProps = {
  /** Aggregated change set for a turn or session. */
  changeSet: ChangeSet;
  /**
   * Open a single-file preview when the row has no diff data.
   * @param path Workspace path.
   */
  onOpenFile?: (path: string) => void;
};

/**
 * Vertical list: sticky path header + structured diff per file.
 * @param props Change set + optional file open fallback.
 */
export function PreviewChangeListView(props: PreviewChangeListViewProps) {
  const { changeSet, onOpenFile } = props;
  if (changeSet.files.length === 0) {
    return <div className="preview-empty">No file changes in this scope.</div>;
  }
  return (
    <div className="preview-change-list" data-kind="preview-changeset">
      <div className="preview-change-summary">
        Edited {changeSet.fileCount} file{changeSet.fileCount === 1 ? "" : "s"}{" "}
        <span className="preview-count-add">+{changeSet.added}</span>{" "}
        <span className="preview-count-del">−{changeSet.removed}</span>
      </div>
      {changeSet.files.map((file) => {
        if (file.status === "no_diff_data") {
          return (
            <section key={file.path} className="preview-change-file">
              <header className="preview-change-file-head">
                <span className="preview-change-file-path" title={file.path}>
                  {file.path}
                </span>
                <span className="preview-change-file-meta">no diff data</span>
              </header>
              {onOpenFile ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onOpenFile(file.path)}
                >
                  Open file preview
                </button>
              ) : null}
            </section>
          );
        }
        const fileDiff = buildFileDiff(file.baseText, file.headText);
        return (
          <section key={file.path} className="preview-change-file">
            <header className="preview-change-file-head">
              <span className="preview-change-file-path" title={file.path}>
                {file.path}
              </span>
              <span className="preview-change-file-meta">
                <span className="preview-count-add">+{file.added}</span>{" "}
                <span className="preview-count-del">−{file.removed}</span>
                {file.status === "no_baseline" ? " · no baseline" : ""}
                {file.status === "failed" ? " · failed" : ""}
                {file.degraded || fileDiff.degraded ? " · ≈" : ""}
              </span>
            </header>
            {/* path drives the grammar only — the sticky header above already
              * shows it, so the diff's own path row is suppressed. */}
            <PreviewDiffWidget
              fileDiff={fileDiff}
              path={file.path}
              showPath={false}
              oldText={file.baseText ?? ""}
              newText={file.headText ?? ""}
            />
          </section>
        );
      })}
    </div>
  );
}
