/**
 * Body of one file in the git change list. Rebuilds whole old / new texts
 * from the full-context patch (gitPatch) and paints them with the shared
 * PreviewDiffWidget, so gap expansion and line numbers work without extra
 * disk reads. Binary / oversized / budget-omitted / content-free changes get
 * an explanatory note instead (with Load / Open actions).
 *
 * Line comments: when the panel passes its review model and the patch is
 * complete (absolute line numbers), the diff is wrapped in
 * DiffCommentFileContext so rows paint the comment gutter / composer.
 */

import { useMemo } from "react";
import { buildFileDiff } from "@/lib/diffCore";
import type { DiffViewPrefs } from "@/lib/diffViewPrefs";
import { patchToTexts } from "@/lib/gitPatch";
import type { GitDiffFile } from "@/lib/gitTypes";
import {
  DiffCommentFileContext,
  useDiffCommentFileModel,
  type ReviewCommentsModel,
} from "@/widgets/review";
import { PreviewDiffWidget } from "./PreviewDiffWidget";

export type GitChangeFileWidgetProps = {
  /** Diff row from git_diff. */
  file: GitDiffFile;
  /** Absolute path (language detection + open-file). */
  absPath: string;
  /** Shared list prefs (controlled). */
  viewPrefs: DiffViewPrefs;
  /** Persist prefs changed from inside the body. */
  onViewPrefsChange: (next: DiffViewPrefs) => void;
  /** Load an omitted file's patch on its own. */
  onLoad: (file: GitDiffFile) => void;
  /** Open the file preview. */
  onOpenFile: (absPath: string) => void;
  /** Panel review-comment model; omitted / null disables line comments. */
  review?: ReviewCommentsModel | null;
};

/**
 * Note row with optional actions for files that have no inline diff.
 * @param props Message and optional buttons.
 * @returns Note element.
 */
function FileNote(props: { text: string; actions?: Array<{ label: string; run: () => void }> }) {
  return (
    <div className="git-file-note">
      <span>{props.text}</span>
      {(props.actions ?? []).map((a) => (
        <button key={a.label} type="button" className="btn-ghost" onClick={a.run}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One file's diff (or explanation).
 * @param props File, absolute path, prefs and load / open callbacks.
 * @returns Diff body.
 */
export function GitChangeFileWidget(props: GitChangeFileWidgetProps) {
  const { file, absPath, onOpenFile, onLoad } = props;
  const texts = useMemo(() => patchToTexts(file.patch), [file.patch]);
  const fileDiff = useMemo(
    () => buildFileDiff(texts.oldText, texts.newText),
    [texts.oldText, texts.newText],
  );
  /** Comment model for this file (null → plain diff). */
  const commentModel = useDiffCommentFileModel({
    review: props.review ?? null,
    path: file.path,
    fileDiff,
    oldText: texts.oldText,
    newText: texts.newText,
    absoluteLines: texts.complete,
  });
  const open = { label: "Open file", run: () => onOpenFile(absPath) };
  if (file.binary) {
    return <FileNote text="Binary file — no text diff." />;
  }
  if (file.tooLarge) {
    return <FileNote text="Diff too large to show inline." actions={file.status === "deleted" ? [] : [open]} />;
  }
  if (file.omitted) {
    return (
      <FileNote
        text="Diff not loaded (change set is large)."
        actions={[{ label: "Load diff", run: () => onLoad(file) }]}
      />
    );
  }
  if (texts.hunks === 0) {
    const what = file.status === "renamed" ? "Renamed without content changes." : "No content changes (mode or empty file).";
    return <FileNote text={what} />;
  }
  return (
    <DiffCommentFileContext.Provider value={commentModel}>
      <PreviewDiffWidget
        fileDiff={fileDiff}
        path={absPath}
        showPath={false}
        oldText={texts.oldText}
        newText={texts.newText}
        hideToolbar
        viewPrefs={props.viewPrefs}
        onViewPrefsChange={props.onViewPrefsChange}
        relativeLineNumbers={!texts.complete}
        banner={texts.complete ? null : "Partial diff — showing changed regions only."}
      />
    </DiffCommentFileContext.Provider>
  );
}
