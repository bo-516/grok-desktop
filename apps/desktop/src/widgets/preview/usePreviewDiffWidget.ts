/**
 * Unified entry hook for PreviewDiffWidget: highlights both sides, owns
 * layout prefs (local or parent-controlled), gap reveal (useDiffGapReveal),
 * the ⋯ menu open state, and Alt+↑/↓ change-run focus. Returns ready props
 * for PreviewDiffMenuView and PreviewDiffView. Reveal, menu and focus stay
 * local to the widget — not in the store.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { languageForPath } from "@/lib/codeHighlightLanguages";
import { changeRunsFromFileDiff } from "@/lib/diffChangeRuns";
import type { FileDiff } from "@/lib/diffCore";
import { buildEmphByRowKey } from "@/lib/diffEmphByRowKey";
import { FULL_FILE_LINE_GATE, splitDiffSourceLines } from "@/lib/diffGapExpand";
import {
  loadDiffViewPrefs,
  patchDiffViewPrefs,
  saveDiffViewPrefs,
  type DiffViewPrefs,
} from "@/lib/diffViewPrefs";
import { useCodeHighlight } from "@/widgets/shared";
import type { PreviewDiffMenuViewProps } from "./PreviewDiffMenuView";
import type {
  PreviewDiffReviewProps,
  PreviewDiffViewProps,
} from "./PreviewDiffView";
import { useDiffGapReveal } from "./useDiffGapReveal";

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

export type PreviewDiffWidgetModel = {
  /** Escape closes the menu; Alt+↑/↓ steps the focused change run. */
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Props for the floating ⋯ menu; null when `hideToolbar` is set. */
  menuProps: PreviewDiffMenuViewProps | null;
  /** Props for the stateless diff body. */
  diffViewProps: PreviewDiffViewProps;
};

/**
 * Compose highlight, prefs, reveal, menu and run focus for one file diff.
 * @param props Widget props (diff, path, texts, optional review / controlled prefs).
 * @returns Key handler plus prop bags for the menu and the diff body.
 */
export function usePreviewDiffWidget(
  props: PreviewDiffWidgetProps,
): PreviewDiffWidgetModel {
  const {
    fileDiff,
    path,
    oldText,
    newText,
    viewPrefs,
    onViewPrefsChange,
    onRequestFullFile,
  } = props;
  const language = useMemo(() => languageForPath(path), [path]);
  const oldLines = useCodeHighlight(oldText, language);
  const newLines = useCodeHighlight(newText, language);

  const oldTextLines = useMemo(() => splitDiffSourceLines(oldText), [oldText]);
  const newTextLines = useMemo(() => splitDiffSourceLines(newText), [newText]);

  const controlled = viewPrefs !== undefined;
  const [localPrefs, setLocalPrefs] = useState<DiffViewPrefs>(() =>
    loadDiffViewPrefs(),
  );
  const prefs = viewPrefs ?? localPrefs;
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusedRunIndex, setFocusedRunIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const lineCount = Math.max(oldTextLines.length, newTextLines.length);
  const fullFileBlocked = lineCount > FULL_FILE_LINE_GATE;

  const updatePrefs = useCallback(
    (patch: Partial<DiffViewPrefs>) => {
      if (controlled && onViewPrefsChange) {
        onViewPrefsChange(patchDiffViewPrefs(prefs, patch));
        return;
      }
      setLocalPrefs((cur) => {
        const next = patchDiffViewPrefs(cur, patch);
        saveDiffViewPrefs(next);
        return next;
      });
    },
    [controlled, prefs, onViewPrefsChange],
  );

  const { revealByGap, onRevealChange, togglePreferFullFile } =
    useDiffGapReveal({
      fileDiff,
      path,
      oldText,
      newText,
      preferFullFile: prefs.preferFullFile,
      fullFileBlocked,
      onRequestFullFile,
      updatePrefs,
    });

  const emphByRowKey = useMemo(() => buildEmphByRowKey(fileDiff), [fileDiff]);
  const runs = useMemo(() => changeRunsFromFileDiff(fileDiff), [fileDiff]);

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

  /** Menu chrome is on unless a parent surfaces the same controls. */
  const menuProps: PreviewDiffMenuViewProps | null =
    props.hideToolbar !== true
      ? {
          anchorRef: menuRef,
          open: menuOpen,
          preferFullFile: prefs.preferFullFile,
          fullFileBlocked,
          dualGutter: prefs.dualGutter,
          wrap: prefs.wrap,
          onToggleOpen: () => setMenuOpen((o) => !o),
          onToggleFullFile: () => {
            togglePreferFullFile();
            setMenuOpen(false);
          },
          onToggleDualGutter: () => {
            updatePrefs({ dualGutter: !prefs.dualGutter });
            setMenuOpen(false);
          },
          onToggleWrap: () => {
            updatePrefs({ wrap: !prefs.wrap });
            setMenuOpen(false);
          },
        }
      : null;

  return {
    onKeyDown,
    menuProps,
    diffViewProps: {
      fileDiff,
      path: props.showPath === false ? undefined : path,
      oldLines: oldLines ?? undefined,
      newLines: newLines ?? undefined,
      oldTextLines,
      newTextLines,
      revealByGap,
      onRevealChange,
      dualGutter: prefs.dualGutter,
      wrap: prefs.wrap,
      relativeLineNumbers: props.relativeLineNumbers,
      banner: props.banner,
      emphByRowKey,
      review: props.review,
      focusedRunIndex,
    },
  };
}
