/**
 * Stateful shell for one structured file diff: gap reveal state, layout prefs,
 * word-emph memo, optional keyboard jump between change runs. Hands a pure
 * props bag to PreviewDiffView. Reveal and focus stay local — not in the store.
 *
 * Display options (⋯) float over the scroll area instead of a full-width
 * toolbar band so the narrow drawer keeps vertical space for code.
 * When viewPrefs are controlled by a parent (Changes list chrome), local
 * storage is not used for those fields so all files share one setting.
 */

import { MoreHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { languageForPath } from "@/lib/codeHighlightLanguages";
import {
  changeRunsFromFileDiff,
  diffRowKey,
} from "@/lib/diffChangeRuns";
import type { FileDiff } from "@/lib/diffCore";
import {
  FULL_FILE_LINE_GATE,
  fullRevealByGap,
  revealAfterSourceChange,
  splitDiffSourceLines,
  type GapReveal,
} from "@/lib/diffGapExpand";
import type { HunkDecision } from "@/lib/diffHunkApply";
import {
  loadDiffViewPrefs,
  patchDiffViewPrefs,
  saveDiffViewPrefs,
  type DiffViewPrefs,
} from "@/lib/diffViewPrefs";
import {
  wordRangesForRun,
  type EmphRange,
} from "@/lib/diffWordRanges";
import { useCodeHighlight } from "@/widgets/shared";
import {
  PreviewDiffView,
  type PreviewDiffReviewProps,
} from "./PreviewDiffView";

export type PreviewDiffWidgetProps = {
  /** Structured diff already built from the two texts. */
  fileDiff: FileDiff;
  /** Absolute file path; its extension selects the grammar for both sides. */
  path: string;
  /** Pre-edit file text; empty for a newly created file. */
  oldText: string;
  /** Post-edit file text; empty for a deleted file. */
  newText: string;
  /**
   * Whether to print the path above the first hunk. False where the caller
   * already shows it (drawer head / change-list sticky file header).
   */
  showPath?: boolean;
  /** Optional single-paint review chrome (Accept/Reject on change runs). */
  review?: PreviewDiffReviewProps;
  /**
   * Hide the floating ⋯ menu. Prefer leaving it on so full-file / dual gutter
   * / wrap stay reachable; only hide when a parent already surfaces the same
   * controls (Changes list chrome).
   */
  hideToolbar?: boolean;
  /**
   * Controlled layout prefs from a parent (e.g. Changes list). When set with
   * onViewPrefsChange, the widget does not read/write localStorage itself.
   */
  viewPrefs?: DiffViewPrefs;
  /**
   * Persist controlled prefs. Required when viewPrefs is provided for toggles
   * to take effect across all files in the list.
   */
  onViewPrefsChange?: (next: DiffViewPrefs) => void;
  /**
   * Called before the first gap expand / Show full file so the parent can
   * reconstruct full texts from disk. May return a promise; expand still runs.
   */
  onRequestFullFile?: () => void | Promise<void>;
  /** Fragment-relative gutters when disk is not aligned yet. */
  relativeLineNumbers?: boolean;
  /** Optional alignment / fragment banner above the body. */
  banner?: string | null;
};

/**
 * Highlight both sides, own expand/prefs state, render structured hunks.
 * @param props Diff, path, texts, optional review / controlled prefs.
 */
export function PreviewDiffWidget(props: PreviewDiffWidgetProps) {
  const language = useMemo(() => languageForPath(props.path), [props.path]);
  const oldLines = useCodeHighlight(props.oldText, language);
  const newLines = useCodeHighlight(props.newText, language);

  const oldTextLines = useMemo(
    () => splitDiffSourceLines(props.oldText),
    [props.oldText],
  );
  const newTextLines = useMemo(
    () => splitDiffSourceLines(props.newText),
    [props.newText],
  );

  const controlled = props.viewPrefs !== undefined;
  const [localPrefs, setLocalPrefs] = useState<DiffViewPrefs>(() =>
    loadDiffViewPrefs(),
  );
  const prefs = props.viewPrefs ?? localPrefs;
  const [revealByGap, setRevealByGap] = useState<Record<string, GapReveal>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusedRunIndex, setFocusedRunIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** True after the first expand/show-full requested parent disk align. */
  const requestedFullRef = useRef(false);

  const lineCount = Math.max(oldTextLines.length, newTextLines.length);
  const fullFileBlocked = lineCount > FULL_FILE_LINE_GATE;

  const requestFullFileOnce = useCallback(() => {
    if (requestedFullRef.current) {
      return;
    }
    requestedFullRef.current = true;
    if (props.onRequestFullFile) {
      void props.onRequestFullFile();
    }
  }, [props.onRequestFullFile]);

  /**
   * Previous painted source identity — reconstruct updates texts without path
   * change; path switch must re-allow disk request.
   */
  const prevSourceRef = useRef({
    path: props.path,
    oldText: props.oldText,
    newText: props.newText,
  });

  /**
   * Previous preferFullFile so we can detect off → collapse without treating
   * every mount as a "turned off" wipe of local step-reveals.
   */
  const prevPreferFullRef = useRef(prefs.preferFullFile);

  /*
   * Prefer-full + reconstruct policy (pure helper revealAfterSourceChange):
   * - preferFullFile on → expand every gap on the *current* FileDiff (sticks
   *   across reconstruct re-diff; old fragment gap keys are discarded).
   * - preferFullFile toggled off → clear reveal (back to change-only fragments).
   * - source texts/path change without preferFullFile → clear reveal (geometry
   *   changed; partial expands cannot map).
   * - preferFullFile off and same source → leave local reveal alone (user steps).
   * Never wipe after expand in a separate effect — that was the P1 bug.
   */
  useEffect(() => {
    const prev = prevSourceRef.current;
    const pathChanged = prev.path !== props.path;
    const sourceChanged =
      pathChanged ||
      prev.oldText !== props.oldText ||
      prev.newText !== props.newText;
    prevSourceRef.current = {
      path: props.path,
      oldText: props.oldText,
      newText: props.newText,
    };
    const wasPreferFull = prevPreferFullRef.current;
    prevPreferFullRef.current = prefs.preferFullFile;
    if (pathChanged) {
      requestedFullRef.current = false;
    }
    if (prefs.preferFullFile && !fullFileBlocked && !props.fileDiff.degraded) {
      requestFullFileOnce();
      setRevealByGap(fullRevealByGap(props.fileDiff));
      return;
    }
    const preferTurnedOff = wasPreferFull && !prefs.preferFullFile;
    if (preferTurnedOff || sourceChanged) {
      setRevealByGap(
        revealAfterSourceChange(props.fileDiff, {
          preferFullFile: false,
          fullFileBlocked,
        }),
      );
    }
  }, [
    props.path,
    props.oldText,
    props.newText,
    props.fileDiff,
    prefs.preferFullFile,
    fullFileBlocked,
    requestFullFileOnce,
  ]);

  const emphByRowKey = useMemo(
    () => buildEmphByRowKey(props.fileDiff),
    [props.fileDiff],
  );

  const runs = useMemo(
    () => changeRunsFromFileDiff(props.fileDiff),
    [props.fileDiff],
  );

  const onRevealChange = useCallback(
    (key: string, next: GapReveal) => {
      requestFullFileOnce();
      setRevealByGap((prev) => ({ ...prev, [key]: next }));
    },
    [requestFullFileOnce],
  );

  const updatePrefs = useCallback(
    (patch: Partial<DiffViewPrefs>) => {
      if (controlled && props.onViewPrefsChange) {
        props.onViewPrefsChange(patchDiffViewPrefs(prefs, patch));
        return;
      }
      setLocalPrefs((cur) => {
        const next = patchDiffViewPrefs(cur, patch);
        saveDiffViewPrefs(next);
        return next;
      });
    },
    [controlled, prefs, props.onViewPrefsChange],
  );

  /**
   * Toggle sticky full-file intent: on expands every gap (+ disk align);
   * off collapses gaps back to the original change-only view. Clears reveal
   * immediately on off so the menu path does not wait for the effect frame.
   */
  const togglePreferFullFile = useCallback(() => {
    if (prefs.preferFullFile) {
      setRevealByGap({});
      updatePrefs({ preferFullFile: false });
      return;
    }
    if (fullFileBlocked) {
      return;
    }
    requestFullFileOnce();
    setRevealByGap(fullRevealByGap(props.fileDiff));
    updatePrefs({ preferFullFile: true });
  }, [
    prefs.preferFullFile,
    fullFileBlocked,
    props.fileDiff,
    updatePrefs,
    requestFullFileOnce,
  ]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape" && menuOpen) {
        e.stopPropagation();
        setMenuOpen(false);
        return;
      }
      if (!e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) {
        return;
      }
      if (runs.length === 0) {
        return;
      }
      e.preventDefault();
      setFocusedRunIndex((cur) => {
        if (cur == null) {
          return e.key === "ArrowDown" ? 0 : runs.length - 1;
        }
        if (e.key === "ArrowDown") {
          return Math.min(runs.length - 1, cur + 1);
        }
        return Math.max(0, cur - 1);
      });
    },
    [runs.length, menuOpen],
  );

  // Clear focus wash after a short beat so it does not stick.
  useEffect(() => {
    if (focusedRunIndex == null) {
      return;
    }
    const t = window.setTimeout(() => setFocusedRunIndex(null), 1200);
    return () => window.clearTimeout(t);
  }, [focusedRunIndex]);

  // Outside click closes the options menu (pointerdown so it wins over button).
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const showMenu = props.hideToolbar !== true;
  /** Tooltip for the sticky full-file menu item (on / off / blocked). */
  const fullFileMenuTitle = prefs.preferFullFile
    ? "Collapse unmodified gaps — show change hunks only"
    : fullFileBlocked
      ? `Files over ${FULL_FILE_LINE_GATE} lines cannot expand fully`
      : "Reveal every unmodified gap";

  return (
    <div
      className="flex flex-col min-h-0 flex-1 relative"
      data-kind="preview-diff-widget"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {showMenu ? (
        <div className="preview-diff-menu-anchor" ref={menuRef}>
          <button
            type="button"
            className="btn-ghost"
            aria-label="Diff display options"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="preview-diff-menu" role="menu">
              <button
                type="button"
                className="preview-diff-menu-item"
                role="menuitem"
                aria-pressed={prefs.preferFullFile}
                disabled={fullFileBlocked && !prefs.preferFullFile}
                title={fullFileMenuTitle}
                onClick={() => {
                  togglePreferFullFile();
                  setMenuOpen(false);
                }}
              >
                {prefs.preferFullFile ? "✓ " : ""}Show full file
                {fullFileBlocked && !prefs.preferFullFile ? " (too large)" : ""}
              </button>
              <button
                type="button"
                className="preview-diff-menu-item"
                role="menuitem"
                aria-pressed={prefs.dualGutter}
                onClick={() => {
                  updatePrefs({ dualGutter: !prefs.dualGutter });
                  setMenuOpen(false);
                }}
              >
                {prefs.dualGutter ? "✓ " : ""}Dual line numbers
              </button>
              <button
                type="button"
                className="preview-diff-menu-item"
                role="menuitem"
                aria-pressed={prefs.wrap}
                onClick={() => {
                  updatePrefs({ wrap: !prefs.wrap });
                  setMenuOpen(false);
                }}
              >
                {prefs.wrap ? "✓ " : ""}Wrap lines
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <PreviewDiffView
        fileDiff={props.fileDiff}
        path={props.showPath === false ? undefined : props.path}
        oldLines={oldLines ?? undefined}
        newLines={newLines ?? undefined}
        oldTextLines={oldTextLines}
        newTextLines={newTextLines}
        revealByGap={revealByGap}
        onRevealChange={onRevealChange}
        dualGutter={prefs.dualGutter}
        wrap={prefs.wrap}
        relativeLineNumbers={props.relativeLineNumbers}
        banner={props.banner}
        emphByRowKey={emphByRowKey}
        review={props.review}
        focusedRunIndex={focusedRunIndex}
      />
    </div>
  );
}

/**
 * Build rowKey → emph ranges for every add/del row in each change run.
 * Same rows and unpaired extras get no entry (row bg only).
 * @param fileDiff Structured diff (degraded short-circuits to empty map).
 */
function buildEmphByRowKey(fileDiff: FileDiff): Map<string, EmphRange[]> {
  const map = new Map<string, EmphRange[]>();
  if (fileDiff.degraded) {
    return map;
  }
  const runs: Array<{
    dels: Array<{ key: string; text: string }>;
    adds: Array<{ key: string; text: string }>;
  }> = [];
  let dels: Array<{ key: string; text: string }> = [];
  let adds: Array<{ key: string; text: string }> = [];
  const flush = () => {
    if (dels.length === 0 && adds.length === 0) {
      return;
    }
    runs.push({ dels, adds });
    dels = [];
    adds = [];
  };
  for (const block of fileDiff.blocks) {
    if (block.kind === "gap") {
      flush();
      continue;
    }
    for (const row of block.rows) {
      if (row.type === "same") {
        flush();
        continue;
      }
      if (row.type === "del") {
        dels.push({ key: diffRowKey(row), text: row.text });
      } else {
        adds.push({ key: diffRowKey(row), text: row.text });
      }
    }
  }
  flush();

  for (const run of runs) {
    const ranges = wordRangesForRun(
      run.dels.map((d) => d.text),
      run.adds.map((a) => a.text),
      { degraded: fileDiff.degraded },
    );
    for (let i = 0; i < run.dels.length; i += 1) {
      const r = ranges.del[i];
      const row = run.dels[i];
      if (r && r.length > 0 && row) {
        map.set(row.key, r);
      }
    }
    for (let i = 0; i < run.adds.length; i += 1) {
      const r = ranges.add[i];
      const row = run.adds[i];
      if (r && r.length > 0 && row) {
        map.set(row.key, r);
      }
    }
  }
  return map;
}

/** Decision record helper for review shells. */
export type { HunkDecision };
