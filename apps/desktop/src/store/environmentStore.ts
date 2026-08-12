/**
 * Environment sheet state — inspect snapshot, page, doctor cache, pending writes.
 * Snapshot outlives the sheet so reopen is instant; pages subscribe by field.
 */

import { create } from "zustand";
import {
  mergeMcpRows,
  normalizeDoctorHealth,
  normalizeInspect,
  type InspectSnapshot,
  type McpHealth,
  type McpRow,
} from "@/lib/inspectModel";

/** Pages available in Phase 1 (nav still lists stubs for later phases). */
export type EnvironmentPageId =
  | "overview"
  | "mcp"
  | "skills"
  | "agents"
  | "plugins"
  | "marketplaces"
  | "hooks"
  | "rules"
  | "compat";

/** Load lifecycle for the inspect snapshot. */
export type EnvironmentStatus = "idle" | "loading" | "ready" | "error";

/** CLI runner signature matching sessionStore.runCli. */
export type EnvironmentCliRunner = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

/** Staleness window: reopen after this many ms triggers a silent refresh. */
export const ENVIRONMENT_STALE_MS = 60_000;

type EnvironmentState = {
  /** Active left-nav page. */
  page: EnvironmentPageId;
  /** Normalized inspect + merged MCP rows (null before first successful load). */
  snapshot: InspectSnapshot | null;
  /** Load lifecycle. */
  status: EnvironmentStatus;
  /** Last load error message. */
  error: string | null;
  /** Epoch ms of last successful load. */
  loadedAt: number | null;
  /** Per-server doctor results, cached across sheet close/open. */
  doctor: Record<string, McpHealth>;
  /** In-flight write actions, keyed `${domain}:${name}:${action}`. */
  pending: Record<string, true>;
  /**
   * Select the active page (deep link / nav).
   * @param page Page id to show.
   */
  setPage: (page: EnvironmentPageId) => void;
  /**
   * Load inspect + mcp list, merge, and store. Safe to call while open or closed.
   * @param runCli Bridge CLI runner from sessionStore.
   * @param opts.force When true, ignore cache and always refetch.
   */
  load: (
    runCli: EnvironmentCliRunner,
    opts?: { force?: boolean },
  ) => Promise<void>;
  /**
   * Run doctor for one MCP server and merge health into cache + snapshot.
   * @param runCli Bridge CLI runner.
   * @param name Server name.
   */
  runDoctor: (runCli: EnvironmentCliRunner, name: string) => Promise<void>;
  /**
   * Run a write action (enable/disable/remove/…) with pending key tracking.
   * Phase 1 UI is mostly read-only; actions exist for later pages and tests.
   * @param runCli Bridge CLI runner.
   * @param key Pending key `${domain}:${name}:${action}`.
   * @param command CLI command id.
   * @param args CLI args bag.
   * @returns Whether the CLI reported ok.
   */
  runAction: (
    runCli: EnvironmentCliRunner,
    key: string,
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<boolean>;
  /** Clear error banner without reloading. */
  clearError: () => void;
};

/**
 * Apply doctor cache onto the snapshot's MCP rows (immutable).
 * @param snapshot Current snapshot or null.
 * @param doctor Health map.
 * @returns Snapshot with merged health, or null.
 */
function withDoctorOnSnapshot(
  snapshot: InspectSnapshot | null,
  doctor: Record<string, McpHealth>,
): InspectSnapshot | null {
  if (!snapshot) {
    return null;
  }
  const mcpServers = snapshot.mcpServers.map((row) => {
    const health = doctor[row.name];
    return health ? { ...row, health } : row;
  });
  return { ...snapshot, mcpServers };
}

/**
 * Whether the snapshot is fresh enough to skip a network/CLI reload.
 * @param loadedAt Last success time.
 * @param now Current epoch ms.
 * @param force Force flag from caller.
 */
function isFresh(
  loadedAt: number | null,
  now: number,
  force: boolean,
): boolean {
  if (force || loadedAt == null) {
    return false;
  }
  return now - loadedAt < ENVIRONMENT_STALE_MS;
}

/**
 * Zustand store for the Agent environment sheet.
 * Subscribe by field so Overview re-renders do not thrash MCP list consumers.
 */
export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  page: "overview",
  snapshot: null,
  status: "idle",
  error: null,
  loadedAt: null,
  doctor: {},
  pending: {},

  setPage: (page) => set({ page }),

  clearError: () => set({ error: null }),

  load: async (runCli, opts) => {
    const force = opts?.force === true;
    const state = get();
    const now = Date.now();
    if (
      !force &&
      state.status === "ready" &&
      isFresh(state.loadedAt, now, false)
    ) {
      return;
    }
    if (state.status === "loading") {
      return;
    }
    set({ status: "loading", error: null });
    try {
      const [insp, mcpList] = await Promise.all([
        runCli("inspect"),
        runCli("mcp_list"),
      ]);
      if (!insp.ok) {
        set({
          status: "error",
          error: insp.error ?? "inspect failed",
        });
        return;
      }
      const base = normalizeInspect(insp.data);
      const doctor = get().doctor;
      const mergedMcp = mergeMcpRows(
        base.mcpServers,
        mcpList.ok ? mcpList.data : [],
        doctor,
      );
      const snapshot: InspectSnapshot = {
        ...base,
        mcpServers: mergedMcp,
      };
      set({
        snapshot,
        status: "ready",
        error: null,
        loadedAt: Date.now(),
      });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  runDoctor: async (runCli, name) => {
    const key = `mcp:${name}:doctor`;
    const pending = { ...get().pending, [key]: true as const };
    set({ pending });
    try {
      const result = await runCli("mcp_doctor", { name });
      if (!result.ok) {
        set({
          error: result.error ?? `doctor failed for ${name}`,
          pending: omitPending(get().pending, key),
        });
        return;
      }
      const parsed = normalizeDoctorHealth(result.data);
      const doctor = { ...get().doctor, ...parsed };
      // If doctor returned nothing for this name, still record a failing stub.
      if (!doctor[name] && result.data != null) {
        const raw = result.data as { ok?: boolean; raw?: string };
        doctor[name] = {
          healthy: raw.ok === true,
          summary:
            typeof raw.raw === "string" && raw.raw
              ? raw.raw.slice(0, 200)
              : "doctor returned no server row",
          checks: [],
        };
      }
      set({
        doctor,
        snapshot: withDoctorOnSnapshot(get().snapshot, doctor),
        pending: omitPending(get().pending, key),
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        pending: omitPending(get().pending, key),
      });
    }
  },

  runAction: async (runCli, key, command, args) => {
    const pending = { ...get().pending, [key]: true as const };
    set({ pending });
    try {
      const result = await runCli(command, args);
      set({ pending: omitPending(get().pending, key) });
      if (!result.ok) {
        set({ error: result.error ?? `${command} failed` });
        return false;
      }
      // Refresh snapshot after successful writes so lists stay honest.
      await get().load(runCli, { force: true });
      return true;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        pending: omitPending(get().pending, key),
      });
      return false;
    }
  },
}));

/**
 * Drop one pending key from the map.
 * @param pending Current pending map.
 * @param key Key to remove.
 */
function omitPending(
  pending: Record<string, true>,
  key: string,
): Record<string, true> {
  if (!(key in pending)) {
    return pending;
  }
  const next = { ...pending };
  delete next[key];
  return next;
}

/**
 * Select MCP rows from the store snapshot (stable empty array when unloaded).
 * @param snapshot Store snapshot.
 * @returns MCP rows.
 */
export function selectMcpRows(
  snapshot: InspectSnapshot | null,
): McpRow[] {
  return snapshot?.mcpServers ?? [];
}

/**
 * Human-readable relative loaded time for the toolbar.
 * @param loadedAt Epoch ms or null.
 * @param now Current epoch ms (injectable for tests).
 * @returns e.g. "just now", "2m ago", or null when never loaded.
 */
export function formatLoadedAgo(
  loadedAt: number | null,
  now = Date.now(),
): string | null {
  if (loadedAt == null) {
    return null;
  }
  const sec = Math.max(0, Math.floor((now - loadedAt) / 1000));
  if (sec < 10) {
    return "just now";
  }
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
