/**
 * Gap-reveal state for one structured diff: per-gap step reveals, sticky
 * "Show full file", and the one-shot parent request to align full texts
 * from disk. Local to the diff widget — never in a store.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileDiff } from "@/lib/diffCore";
import {
  fullRevealByGap,
  revealAfterSourceChange,
  type GapReveal,
} from "@/lib/diffGapExpand";
import type { DiffViewPrefs } from "@/lib/diffViewPrefs";

export type UseDiffGapRevealArgs = {
  /** Structured diff currently painted; gap keys come from it. */
  fileDiff: FileDiff;
  /** File path; a change re-allows the one-shot disk request. */
  path: string;
  /** Pre-edit text; with newText, detects reconstruct re-diffs. */
  oldText: string;
  /** Post-edit text; with oldText, detects reconstruct re-diffs. */
  newText: string;
  /** Effective sticky full-file pref (controlled or local). */
  preferFullFile: boolean;
  /** File exceeds FULL_FILE_LINE_GATE; full-file expansion is refused. */
  fullFileBlocked: boolean;
  /**
   * Parent hook to reconstruct full texts from disk before the first expand.
   * Called at most once per path; omitted means expand works on the fragment.
   */
  onRequestFullFile?: () => void | Promise<void>;
  /**
   * Persist a pref patch (controlled or local). Must be stable across renders
   * that do not change prefs, or togglePreferFullFile churns identity.
   */
  updatePrefs: (patch: Partial<DiffViewPrefs>) => void;
};

export type UseDiffGapRevealResult = {
  /** Per-gap reveal amounts keyed by gapRevealKey. */
  revealByGap: Record<string, GapReveal>;
  /**
   * Store one gap's reveal (and fire the one-shot disk request).
   * @param key gapRevealKey of the gap.
   * @param next Next top/bottom reveal amounts.
   */
  onRevealChange: (key: string, next: GapReveal) => void;
  /** Flip sticky full-file; no-op when turning on a blocked file. */
  togglePreferFullFile: () => void;
};

/**
 * Own reveal state and the prefer-full / reconstruct policy for one diff.
 * @param args Diff identity, effective prefs, and parent callbacks.
 * @returns Reveal map plus the two mutators the view and menu call.
 */
export function useDiffGapReveal(
  args: UseDiffGapRevealArgs,
): UseDiffGapRevealResult {
  const {
    fileDiff,
    path,
    oldText,
    newText,
    preferFullFile,
    fullFileBlocked,
    onRequestFullFile,
    updatePrefs,
  } = args;
  const [revealByGap, setRevealByGap] = useState<Record<string, GapReveal>>({});
  /** True after the first expand/show-full requested parent disk align. */
  const requestedFullRef = useRef(false);

  const requestFullFileOnce = useCallback(() => {
    if (requestedFullRef.current) {
      return;
    }
    requestedFullRef.current = true;
    if (onRequestFullFile) {
      void onRequestFullFile();
    }
  }, [onRequestFullFile]);

  /**
   * Previous painted source identity — reconstruct updates texts without path
   * change; path switch must re-allow disk request.
   */
  const prevSourceRef = useRef({ path, oldText, newText });

  /**
   * Previous preferFullFile so we can detect off → collapse without treating
   * every mount as a "turned off" wipe of local step-reveals.
   */
  const prevPreferFullRef = useRef(preferFullFile);

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
    const pathChanged = prev.path !== path;
    const sourceChanged =
      pathChanged || prev.oldText !== oldText || prev.newText !== newText;
    prevSourceRef.current = { path, oldText, newText };
    const wasPreferFull = prevPreferFullRef.current;
    prevPreferFullRef.current = preferFullFile;
    if (pathChanged) {
      requestedFullRef.current = false;
    }
    if (preferFullFile && !fullFileBlocked && !fileDiff.degraded) {
      requestFullFileOnce();
      setRevealByGap(fullRevealByGap(fileDiff));
      return;
    }
    const preferTurnedOff = wasPreferFull && !preferFullFile;
    if (preferTurnedOff || sourceChanged) {
      setRevealByGap(
        revealAfterSourceChange(fileDiff, {
          preferFullFile: false,
          fullFileBlocked,
        }),
      );
    }
  }, [
    path,
    oldText,
    newText,
    fileDiff,
    preferFullFile,
    fullFileBlocked,
    requestFullFileOnce,
  ]);

  const onRevealChange = useCallback(
    (key: string, next: GapReveal) => {
      requestFullFileOnce();
      setRevealByGap((prev) => ({ ...prev, [key]: next }));
    },
    [requestFullFileOnce],
  );

  /**
   * Toggle sticky full-file intent: on expands every gap (+ disk align);
   * off collapses gaps back to the original change-only view. Clears reveal
   * immediately on off so the menu path does not wait for the effect frame.
   */
  const togglePreferFullFile = useCallback(() => {
    if (preferFullFile) {
      setRevealByGap({});
      updatePrefs({ preferFullFile: false });
      return;
    }
    if (fullFileBlocked) {
      return;
    }
    requestFullFileOnce();
    setRevealByGap(fullRevealByGap(fileDiff));
    updatePrefs({ preferFullFile: true });
  }, [
    preferFullFile,
    fullFileBlocked,
    fileDiff,
    updatePrefs,
    requestFullFileOnce,
  ]);

  return { revealByGap, onRevealChange, togglePreferFullFile };
}
