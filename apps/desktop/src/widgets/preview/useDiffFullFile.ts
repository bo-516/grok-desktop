/**
 * Lazy full-file alignment for ACP window fragments.
 * Reads disk once on first expand / Show full file / Apply verify, then
 * reconstructs full old/new texts so expand, line numbers, and write-back share
 * one source. Pure reconstruct lives in diffFullFile; this hook owns React state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFileDiff, type FileDiff } from "@/lib/diffCore";
import {
  applyDisabledReason,
  canApplyWholeFile,
  fullFileUnavailableLabel,
  reconstructFullTexts,
} from "@/lib/diffFullFile";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Fragment ↔ disk alignment state (UI + Apply).
 * idle/loading/unavailable → relative (~) line numbers; whole/window → absolute.
 */
export type FullFileUiState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "whole" }
  | { state: "window"; startLine: number }
  | { state: "unavailable"; reason: string; startLine?: number };

export type ApplyGate = {
  /** True only when write-back of newText cannot truncate the on-disk file. */
  canApply: boolean;
  /** Chinese reason when canApply is false; null when allowed or still checking. */
  reason: string | null;
  /** True while the first disk verify is in flight. */
  checking: boolean;
};

/** Result of ensureFullFile including texts ready for Apply (state may lag one frame). */
export type EnsureFullFileResult = {
  fullFile: FullFileUiState;
  /** Aligned or fragment old text to feed applyHunkDecisions. */
  oldText: string;
  /** Aligned or fragment new text; must equal disk when Apply is safe. */
  newText: string;
  /** Disk text when read succeeded; null when read failed. */
  diskText: string | null;
};

export type UseDiffFullFileResult = {
  /** Texts to paint / review (fragment until alignment succeeds). */
  oldText: string;
  newText: string;
  fileDiff: FileDiff;
  fullFile: FullFileUiState;
  /**
   * Ensure disk has been read and reconstruct attempted.
   * Idempotent after whole/window/unavailable settles.
   * Returns texts immediately (do not wait for React state flush before Apply).
   */
  ensureFullFile: () => Promise<EnsureFullFileResult>;
  /** Apply footer gate (disk === newText after alignment, or whole fragment). */
  applyGate: ApplyGate;
  /** Whether gutter should show relative (~) line numbers. */
  relativeLineNumbers: boolean;
};

export type UseDiffFullFileOptions = {
  /** Workspace path for previewWorkspaceFile / write. */
  path: string;
  /** Fragment old side from ACP. */
  fragOld: string;
  /** Fragment new side from ACP. */
  fragNew: string;
  /**
   * When true (changeSet multi-fragment discontinuity), skip reconstruct and
   * mark unavailable/stale immediately — merged texts are not trustworthy.
   */
  forceUnavailable?: boolean;
  /** Optional reason string when forceUnavailable. */
  forceUnavailableReason?: string;
};

/**
 * Align a window fragment to disk on demand; verify Apply safety on mount.
 * @param options Path + fragment texts + optional force-unavailable.
 */
export function useDiffFullFile(
  options: UseDiffFullFileOptions,
): UseDiffFullFileResult {
  const {
    path,
    fragOld,
    fragNew,
    forceUnavailable = false,
    forceUnavailableReason = "stale",
  } = options;
  const live = useSessionStore((s) => s.live);
  const workspace = useSessionStore((s) => s.session.workspace);

  const [fullFile, setFullFile] = useState<FullFileUiState>(() =>
    forceUnavailable
      ? { state: "unavailable", reason: forceUnavailableReason }
      : { state: "idle" },
  );
  const [alignedOld, setAlignedOld] = useState<string | null>(null);
  const [alignedNew, setAlignedNew] = useState<string | null>(null);
  const [applyGate, setApplyGate] = useState<ApplyGate>({
    canApply: false,
    reason: applyDisabledReason("unverified"),
    checking: true,
  });
  /** In-flight ensure so concurrent expand + Apply share one read. */
  const ensurePromiseRef = useRef<Promise<EnsureFullFileResult> | null>(null);
  /** Latest settled texts for ensure when already aligned (avoids stale closure). */
  const alignedRef = useRef<{ old: string; new: string } | null>(null);

  const oldText = alignedOld ?? fragOld;
  const newText = alignedNew ?? fragNew;
  const fileDiff = useMemo(
    () => buildFileDiff(oldText, newText),
    [oldText, newText],
  );

  // Reset alignment when the fragment identity changes.
  useEffect(() => {
    setAlignedOld(null);
    setAlignedNew(null);
    alignedRef.current = null;
    ensurePromiseRef.current = null;
    if (forceUnavailable) {
      setFullFile({ state: "unavailable", reason: forceUnavailableReason });
      setApplyGate({
        canApply: false,
        reason: applyDisabledReason("unavailable"),
        checking: false,
      });
      return;
    }
    setFullFile({ state: "idle" });
    setApplyGate({
      canApply: false,
      reason: applyDisabledReason("unverified"),
      checking: true,
    });
  }, [path, fragOld, fragNew, forceUnavailable, forceUnavailableReason]);

  const readDisk = useCallback(async (): Promise<
    | { ok: true; text: string }
    | { ok: false; reason: string }
  > => {
    if (!live?.previewWorkspaceFile) {
      return { ok: false, reason: "unverified" };
    }
    const readCwd = workspace?.trim() || undefined;
    try {
      const result = await live.previewWorkspaceFile(path, readCwd);
      if (!result.ok) {
        return { ok: false, reason: "unverified" };
      }
      return { ok: true, text: result.content ?? "" };
    } catch {
      return { ok: false, reason: "unverified" };
    }
  }, [live, path, workspace]);

  const ensureFullFile = useCallback(async (): Promise<EnsureFullFileResult> => {
    if (forceUnavailable) {
      const u: FullFileUiState = {
        state: "unavailable",
        reason: forceUnavailableReason,
      };
      setFullFile(u);
      setApplyGate({
        canApply: false,
        reason: applyDisabledReason("unavailable"),
        checking: false,
      });
      return {
        fullFile: u,
        oldText: fragOld,
        newText: fragNew,
        diskText: null,
      };
    }
    if (
      fullFile.state === "whole" ||
      fullFile.state === "window"
    ) {
      const texts = alignedRef.current ?? {
        old: alignedOld ?? fragOld,
        new: alignedNew ?? fragNew,
      };
      const disk = await readDisk();
      return {
        fullFile,
        oldText: texts.old,
        newText: texts.new,
        diskText: disk.ok ? disk.text : null,
      };
    }
    if (fullFile.state === "unavailable") {
      return {
        fullFile,
        oldText: fragOld,
        newText: fragNew,
        diskText: null,
      };
    }
    if (ensurePromiseRef.current) {
      return ensurePromiseRef.current;
    }
    const run = (async (): Promise<EnsureFullFileResult> => {
      setFullFile({ state: "loading" });
      const disk = await readDisk();
      if (!disk.ok) {
        const u: FullFileUiState = {
          state: "unavailable",
          reason: "not_found",
        };
        setFullFile(u);
        setApplyGate({
          canApply: false,
          reason: applyDisabledReason("unverified"),
          checking: false,
        });
        return {
          fullFile: u,
          oldText: fragOld,
          newText: fragNew,
          diskText: null,
        };
      }
      const result = reconstructFullTexts(disk.text, fragOld, fragNew);
      if (result.kind === "unavailable") {
        const u: FullFileUiState = {
          state: "unavailable",
          reason: result.reason,
        };
        setFullFile(u);
        setApplyGate({
          canApply: false,
          reason: applyDisabledReason(
            canApplyWholeFile(disk.text, fragNew) ? "unavailable" : "partial",
          ),
          checking: false,
        });
        return {
          fullFile: u,
          oldText: fragOld,
          newText: fragNew,
          diskText: disk.text,
        };
      }
      setAlignedOld(result.oldText);
      setAlignedNew(result.newText);
      alignedRef.current = { old: result.oldText, new: result.newText };
      const next: FullFileUiState =
        result.kind === "whole"
          ? { state: "whole" }
          : { state: "window", startLine: result.startLine };
      setFullFile(next);
      // After reconstruct, newText is the full disk (or equal whole fragment).
      const safe = canApplyWholeFile(disk.text, result.newText);
      setApplyGate({
        canApply: safe,
        reason: safe ? null : applyDisabledReason("partial"),
        checking: false,
      });
      return {
        fullFile: next,
        oldText: result.oldText,
        newText: result.newText,
        diskText: disk.text,
      };
    })();
    ensurePromiseRef.current = run;
    try {
      return await run;
    } finally {
      ensurePromiseRef.current = null;
    }
  }, [
    forceUnavailable,
    forceUnavailableReason,
    fullFile,
    readDisk,
    fragOld,
    fragNew,
    alignedOld,
    alignedNew,
  ]);

  // Mount / fragment change: cheap Apply safety without forcing full reconstruct
  // path when fragment is already the whole file (disk === fragNew).
  useEffect(() => {
    if (forceUnavailable) {
      return;
    }
    let cancelled = false;
    const verify = async () => {
      const disk = await readDisk();
      if (cancelled) {
        return;
      }
      if (!disk.ok) {
        setApplyGate({
          canApply: false,
          reason: applyDisabledReason("unverified"),
          checking: false,
        });
        return;
      }
      if (canApplyWholeFile(disk.text, fragNew)) {
        setAlignedOld(fragOld);
        setAlignedNew(fragNew);
        alignedRef.current = { old: fragOld, new: fragNew };
        setFullFile({ state: "whole" });
        setApplyGate({ canApply: true, reason: null, checking: false });
        return;
      }
      // Window fragment — Apply stays disabled until ensureFullFile succeeds.
      setApplyGate({
        canApply: false,
        reason: applyDisabledReason("partial"),
        checking: false,
      });
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, [path, fragOld, fragNew, forceUnavailable, readDisk]);

  const relativeLineNumbers =
    fullFile.state === "idle" ||
    fullFile.state === "loading" ||
    fullFile.state === "unavailable";

  return {
    oldText,
    newText,
    fileDiff,
    fullFile,
    ensureFullFile,
    applyGate,
    relativeLineNumbers,
  };
}

/**
 * Banner copy when full-file alignment is unavailable.
 * @param fullFile UI alignment state.
 */
export function fullFileBannerText(fullFile: FullFileUiState): string | null {
  if (fullFile.state !== "unavailable") {
    return null;
  }
  const reason = fullFileUnavailableLabel(fullFile.reason);
  return `只显示片段 · 无法与磁盘对齐：${reason}`;
}
