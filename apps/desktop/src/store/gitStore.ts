/**
 * Git status per workspace, shared by the top-nav chip and the git change
 * panel. Event-driven only: callers refresh on session switch, turn settle,
 * window focus and after git actions (useGitStatusRefresh / git actions) —
 * there is no polling timer. Diffs are not stored here; the change panel
 * keeps them in its own widget state and refetches when `updatedAt` moves.
 */

import { create } from "zustand";
import { fetchGitStatus, type GitCliRunner } from "@/lib/gitBridge";
import type { GitStatus } from "@/lib/gitTypes";
import { useSessionStore } from "./sessionStore";

/** Status cache entry for one workspace cwd. */
export type GitStatusEntry = {
  /** Last good snapshot; kept while a refresh is in flight or after an error. */
  status: GitStatus | null;
  /** True while a refresh request is in flight. */
  loading: boolean;
  /** Last refresh error (git missing, dubious ownership, …); null when fine. */
  error: string | null;
  /** Epoch ms of the last completed refresh (0 = never); panels refetch on change. */
  updatedAt: number;
};

/** Empty entry for a cwd that has never been refreshed. */
export const EMPTY_GIT_ENTRY: GitStatusEntry = {
  status: null,
  loading: false,
  error: null,
  updatedAt: 0,
};

type GitStoreState = {
  /** cwd → status entry. */
  byCwd: Record<string, GitStatusEntry>;
  /**
   * Re-read `git status` for cwd. Concurrent calls coalesce: one request in
   * flight, plus at most one trailing re-run so a change made during the
   * first request is still observed.
   * @param cwd Absolute session workspace ("" is ignored).
   * @param run Optional runner (tests); defaults to the live bridge.
   */
  refreshStatus: (cwd: string, run?: GitCliRunner) => Promise<void>;
};

/** In-flight refresh per cwd (module scope: not render state). */
const inFlight = new Map<string, Promise<void>>();
/** cwds that asked for another refresh while one was running. */
const rerun = new Set<string>();

/**
 * Cli runner over the live bridge with an explicit cwd (the session store's
 * runCli always uses the *current* workspace, which can change mid-request).
 * @returns Runner that resolves `ok: false` when the bridge is down.
 */
export function liveGitRunner(): GitCliRunner {
  return async (command, args, cwd) => {
    const { live, connectionMode } = useSessionStore.getState();
    if (!live || connectionMode !== "live-bridge") {
      return { ok: false, error: "Bridge not connected" };
    }
    try {
      return await live.cli(command, args, cwd);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/**
 * Zustand store for per-workspace git status. Subscribe to one cwd's entry
 * (`s.byCwd[cwd]`) so other workspaces' refreshes do not re-render.
 */
export const useGitStore = create<GitStoreState>((set) => {
  /**
   * Merge a partial update into one cwd's entry.
   * @param cwd Workspace key.
   * @param patch Fields to replace.
   */
  const patchEntry = (cwd: string, patch: Partial<GitStatusEntry>) => {
    set((s) => ({
      byCwd: { ...s.byCwd, [cwd]: { ...(s.byCwd[cwd] ?? EMPTY_GIT_ENTRY), ...patch } },
    }));
  };

  /**
   * One refresh request (no coalescing).
   * @param cwd Workspace.
   * @param run Runner.
   */
  const runOnce = async (cwd: string, run: GitCliRunner) => {
    patchEntry(cwd, { loading: true });
    try {
      const status = await fetchGitStatus(run, cwd);
      patchEntry(cwd, { status, loading: false, error: null, updatedAt: Date.now() });
    } catch (e) {
      patchEntry(cwd, {
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        updatedAt: Date.now(),
      });
    }
  };

  return {
    byCwd: {},
    refreshStatus: async (cwd, run) => {
      if (!cwd) {
        return;
      }
      const existing = inFlight.get(cwd);
      if (existing) {
        rerun.add(cwd);
        return existing;
      }
      const runner = run ?? liveGitRunner();
      const job = (async () => {
        await runOnce(cwd, runner);
        while (rerun.has(cwd)) {
          rerun.delete(cwd);
          await runOnce(cwd, runner);
        }
      })().finally(() => {
        inFlight.delete(cwd);
      });
      inFlight.set(cwd, job);
      return job;
    },
  };
});

/**
 * Read one cwd's entry without subscribing (actions / effects).
 * @param cwd Workspace.
 * @returns Entry, or the empty entry.
 */
export function getGitEntry(cwd: string): GitStatusEntry {
  return useGitStore.getState().byCwd[cwd] ?? EMPTY_GIT_ENTRY;
}
