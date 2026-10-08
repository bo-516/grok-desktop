/**
 * Shared chrome state for multi-file diff lists: per-file collapse, the
 * list-level layout prefs (wrap / dual gutter / full file) persisted once,
 * and the measured sticky summary height that offsets sticky file heads.
 * Same behavior as PreviewChangeListView's inline state, packaged for the
 * git change list.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  loadDiffViewPrefs,
  patchDiffViewPrefs,
  saveDiffViewPrefs,
  type DiffViewPrefs,
} from "@/lib/diffViewPrefs";

/** First-paint fallback for --preview-summary-h (py-2 + one control row). */
const SUMMARY_H_FALLBACK_PX = 40;

/**
 * Collapse / prefs / measured summary height for one list.
 * @param paths Current file paths (collapse-all target).
 * @param measureKey Value that changes when the summary strip may resize.
 * @returns State + handlers for DiffChangeListChrome and file sections.
 */
export function useDiffListChrome(paths: readonly string[], measureKey: unknown) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [viewPrefs, setViewPrefs] = useState<DiffViewPrefs>(() => loadDiffViewPrefs());
  const [summaryH, setSummaryH] = useState(SUMMARY_H_FALLBACK_PX);
  const chromeRef = useRef<HTMLDivElement>(null);
  const allCollapsed = paths.length > 0 && paths.every((p) => collapsed.has(p));

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

  const onCollapseAll = useCallback(() => setCollapsed(new Set(paths)), [paths]);
  const onExpandAll = useCallback(() => setCollapsed(new Set()), []);

  /** Patch from the list chrome (partial). */
  const onPrefsPatch = useCallback((patch: Partial<DiffViewPrefs>) => {
    setViewPrefs((cur) => {
      const next = patchDiffViewPrefs(cur, patch);
      saveDiffViewPrefs(next);
      return next;
    });
  }, []);

  /** Replace from a file body (PreviewDiffWidget controlled prefs). */
  const onPrefsReplace = useCallback((next: DiffViewPrefs) => {
    setViewPrefs(next);
    saveDiffViewPrefs(next);
  }, []);

  // Measure the sticky strip; the result flows back as state (CSS var).
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const next = el.offsetHeight;
      if (next > 0) {
        setSummaryH((prev) => (prev === next ? prev : next));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureKey]);

  return {
    collapsed,
    toggle,
    allCollapsed,
    onCollapseAll,
    onExpandAll,
    viewPrefs,
    onPrefsPatch,
    onPrefsReplace,
    chromeRef,
    summaryH,
  };
}
