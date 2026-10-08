/**
 * Entry hook for the git change list (preview drawer, changeset targets in a
 * repository). Git diff is the source of truth for the file list and diffs;
 * agent tool cards only provide turn attribution and the per-turn filter.
 * The diff lives in widget state (not a store) and is refetched whenever the
 * shared git status refreshes (session switch, turn settle, focus, actions).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildGitTurnAttribution, type GitTurnRef } from "@/lib/gitAttribution";
import { fetchGitDiff } from "@/lib/gitBridge";
import type { GitDiffFile, GitDiffMode, GitDiffResult } from "@/lib/gitTypes";
import type { PreviewTarget } from "@/store/previewStore";
import { liveGitRunner, useGitStore } from "@/store/gitStore";
import { useSessionStore } from "@/store/sessionStore";

/** Changeset preview targets rendered by the git list. */
export type GitChangeTarget = Extract<PreviewTarget, { kind: "changeset" }>;

/** Turn filter derived from a turn-scoped target. */
export type GitTurnFilter = {
  /** 1-based turn number, or 0 when the turn touched no repo file. */
  index: number;
  /** Whether the list is currently narrowed to the turn's files. */
  active: boolean;
};

/**
 * Turn number for a turn id, from the attribution map.
 * @param attribution Path → turn refs.
 * @param turnId Target turn.
 * @returns 1-based index, or 0 when unknown.
 */
function turnIndexOf(attribution: Map<string, GitTurnRef[]>, turnId: string): number {
  for (const refs of attribution.values()) {
    const hit = refs.find((r) => r.turnId === turnId);
    if (hit) {
      return hit.index;
    }
  }
  return 0;
}

/**
 * Compose diff fetch, attribution, turn filter and per-file lazy loads.
 * @param target Active changeset target (session or turn scope).
 * @returns View-ready state and handlers.
 */
export function useGitChangeListWidget(target: GitChangeTarget) {
  const cwd = useSessionStore((s) => s.session.workspace) ?? "";
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  /** Bumps on every status refresh — the refetch signal. */
  const updatedAt = useGitStore((s) => s.byCwd[cwd]?.updatedAt ?? 0);
  const [mode, setMode] = useState<GitDiffMode>("head");
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterOn, setFilterOn] = useState(true);
  /** Omitted files loaded on demand, keyed by path; reset on refetch. */
  const [loaded, setLoaded] = useState<Record<string, GitDiffFile>>({});
  const turnId = target.scope === "turn" ? target.turnId : "";

  // A new turn target re-narrows the list to that turn.
  useEffect(() => {
    setFilterOn(true);
  }, [turnId]);

  useEffect(() => {
    if (!cwd) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchGitDiff(liveGitRunner(), cwd, { mode }).then(
      (d) => {
        if (!cancelled) {
          setDiff(d);
          setLoaded({});
          setError("");
          setLoading(false);
        }
      },
      (e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, mode, updatedAt]);

  const root = diff?.root ?? "";
  const attribution = useMemo(
    () => buildGitTurnAttribution(timeline, toolCalls, root, cwd),
    [timeline, toolCalls, root, cwd],
  );
  const turnFilter: GitTurnFilter | null = turnId
    ? { index: turnIndexOf(attribution, turnId), active: filterOn }
    : null;

  const files = useMemo(() => {
    const all = (diff?.files ?? []).map((f) => loaded[f.path] ?? f);
    if (!turnId || !filterOn) {
      return all;
    }
    return all.filter((f) => (attribution.get(f.path) ?? []).some((r) => r.turnId === turnId));
  }, [diff, loaded, turnId, filterOn, attribution]);

  const loadFile = useCallback(
    (file: GitDiffFile) => {
      const paths = file.origPath ? [file.path, file.origPath] : [file.path];
      fetchGitDiff(liveGitRunner(), cwd, { mode, base: diff?.base, paths }).then(
        (d) => {
          const hit = d.files.find((f) => f.path === file.path);
          if (hit) {
            setLoaded((prev) => ({ ...prev, [file.path]: hit }));
          }
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    },
    [cwd, mode, diff?.base],
  );

  return {
    cwd,
    root,
    diff,
    files,
    loading,
    error,
    mode,
    setMode,
    turnFilter,
    setFilterOn,
    attribution,
    loadFile,
  };
}
