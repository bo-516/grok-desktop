/**
 * Stateful-light changeset list: sticky summary, collapsible per-file
 * sections, structured diffs (single paint each). Expand/collapse is local.
 * Layout prefs live at the list level so wrap / dual gutter / show-full-file
 * are reachable from the main Changes entry (not only the single-file drawer).
 * "Show full file" is sticky via preferFullFile and toggles back to change-only
 * fragments (collapsed gaps) when turned off — same as the single-file menu.
 * The summary strip is measured so sticky file heads cannot overlap a wrapped
 * chrome row or let "+N −M" paint through the path. Action labels collapse to
 * icons before the strip wraps (see DiffChangeListChrome).
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ChangeSet } from "@/lib/changeSet";
import { buildFileDiff } from "@/lib/diffCore";
import {
  loadDiffViewPrefs,
  patchDiffViewPrefs,
  saveDiffViewPrefs,
  type DiffViewPrefs,
} from "@/lib/diffViewPrefs";
import { toPathDisplay } from "@/lib/pathDisplay";
import { useSessionStore } from "@/store/sessionStore";
import { DiffChangeListChrome } from "./DiffChangeListChrome";
import { DiffFileSectionView } from "./DiffFileSectionView";
import { PreviewDiffWidget } from "./PreviewDiffWidget";
import {
  fullFileBannerText,
  useDiffFullFile,
} from "./useDiffFullFile";

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
 * First-paint fallback for --preview-summary-h until ResizeObserver reports
 * the real strip. 2.5rem matches py-2 + a single btn-ghost row.
 */
const SUMMARY_H_FALLBACK_PX = 40;

/**
 * Vertical list: sticky path header + structured diff per file.
 * Summary height is measured (not hardcoded) so file heads cannot slide
 * under a wrapped strip (icons-first; wrap is last resort) or crush
 * "+N −M" into the path row.
 * @param props Change set + optional file open fallback.
 */
export function PreviewChangeListView(props: PreviewChangeListViewProps) {
  const { changeSet, onOpenFile } = props;
  const workspace = useSessionStore((s) => s.session.workspace) ?? "";
  const paths = useMemo(
    () => changeSet.files.map((f) => f.path),
    [changeSet.files],
  );
  /** Collapsed path set; empty = all expanded (default). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  /** Shared prefs for every file section (one localStorage write). */
  const [viewPrefs, setViewPrefs] = useState<DiffViewPrefs>(() =>
    loadDiffViewPrefs(),
  );
  /** Measured sticky summary height in CSS pixels. */
  const chromeRef = useRef<HTMLDivElement>(null);
  const [summaryH, setSummaryH] = useState(SUMMARY_H_FALLBACK_PX);

  const allCollapsed =
    paths.length > 0 && paths.every((p) => collapsed.has(p));

  const onCollapseAll = useCallback(() => {
    setCollapsed(new Set(paths));
  }, [paths]);

  const onExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const onViewPrefsChange = useCallback((patch: Partial<DiffViewPrefs>) => {
    setViewPrefs((cur) => {
      const next = patchDiffViewPrefs(cur, patch);
      saveDiffViewPrefs(next);
      return next;
    });
  }, []);

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Keep --preview-summary-h in lockstep with the real strip (wrap / font).
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const next = el.offsetHeight;
      if (next <= 0) {
        return;
      }
      setSummaryH((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [changeSet.fileCount]);

  if (changeSet.files.length === 0) {
    return <div className="preview-empty">No file changes in this scope.</div>;
  }

  return (
    <div
      className="preview-change-list"
      data-kind="preview-changeset"
      style={
        {
          ["--preview-summary-h" as string]: `${summaryH}px`,
        } as CSSProperties
      }
    >
      <DiffChangeListChrome
        chromeRef={chromeRef}
        summary={
          <>
            Edited {changeSet.fileCount} file
            {changeSet.fileCount === 1 ? "" : "s"}{" "}
            <span className="preview-count-add">+{changeSet.added}</span>{" "}
            <span className="preview-count-del">−{changeSet.removed}</span>
          </>
        }
        allCollapsed={allCollapsed}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        viewPrefs={viewPrefs}
        onViewPrefsChange={onViewPrefsChange}
      />
      {changeSet.files.map((file) => {
        const expanded = !collapsed.has(file.path);
        const pathDisplay = toPathDisplay(file.path, workspace);
        if (file.status === "no_diff_data") {
          return (
            <DiffFileSectionView
              key={file.path}
              path={file.path}
              pathDisplay={pathDisplay}
              expanded={expanded}
              onToggle={() => toggle(file.path)}
              meta={<span>no diff data</span>}
            >
              {onOpenFile ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onOpenFile(file.path)}
                >
                  Open file preview
                </button>
              ) : null}
            </DiffFileSectionView>
          );
        }
        return (
          <DiffFileSectionView
            key={file.path}
            path={file.path}
            pathDisplay={pathDisplay}
            expanded={expanded}
            onToggle={() => toggle(file.path)}
            meta={
              <>
                <span className="preview-count-add">+{file.added}</span>{" "}
                <span className="preview-count-del">−{file.removed}</span>
                {file.status === "no_baseline" ? " · no baseline" : ""}
                {file.status === "failed" ? " · failed" : ""}
                {file.status === "stale" ? " · stale" : ""}
                {file.degraded ? " · ≈" : ""}
              </>
            }
          >
            {expanded ? (
              <ChangeListFileDiff
                path={file.path}
                baseText={file.baseText ?? ""}
                headText={file.headText ?? ""}
                forceUnavailable={file.status === "stale"}
                viewPrefs={viewPrefs}
                onViewPrefsChange={(next) => {
                  setViewPrefs(next);
                  saveDiffViewPrefs(next);
                }}
              />
            ) : null}
          </DiffFileSectionView>
        );
      })}
    </div>
  );
}

/**
 * One expanded file body: owns full-file alignment for that path and paints
 * a controlled PreviewDiffWidget (hideToolbar — prefs live in list chrome).
 * preferFullFile from shared viewPrefs drives expand/collapse of gaps.
 */
function ChangeListFileDiff(props: {
  path: string;
  baseText: string;
  headText: string;
  forceUnavailable: boolean;
  viewPrefs: DiffViewPrefs;
  onViewPrefsChange: (next: DiffViewPrefs) => void;
}) {
  const {
    path,
    baseText,
    headText,
    forceUnavailable,
    viewPrefs,
    onViewPrefsChange,
  } = props;
  const {
    oldText,
    newText,
    fileDiff,
    fullFile,
    ensureFullFile,
    relativeLineNumbers,
  } = useDiffFullFile({
    path,
    fragOld: baseText,
    fragNew: headText,
    forceUnavailable,
    forceUnavailableReason: "stale",
  });

  const fallbackDiff = useMemo(
    () => buildFileDiff(baseText, headText),
    [baseText, headText],
  );
  const painted = fileDiff.blocks.length > 0 ? fileDiff : fallbackDiff;

  return (
    <PreviewDiffWidget
      fileDiff={painted}
      path={path}
      showPath={false}
      oldText={oldText}
      newText={newText}
      hideToolbar
      viewPrefs={viewPrefs}
      onViewPrefsChange={onViewPrefsChange}
      onRequestFullFile={() => {
        void ensureFullFile();
      }}
      relativeLineNumbers={relativeLineNumbers}
      banner={fullFileBannerText(fullFile)}
    />
  );
}
