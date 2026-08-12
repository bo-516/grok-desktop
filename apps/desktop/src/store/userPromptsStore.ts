/**
 * User-prompts store: three-scope snapshot + load/set/clear/move via cli channel.
 * Desktop holds structured entries only; markdown format lives in the bridge.
 */

import { create } from "zustand";
import type {
  PromptEntry,
  PromptScope,
} from "@/lib/userPrompts";
import { useSessionStore } from "@/store/sessionStore";

/** CLI runner signature matching sessionStore.runCli. */
export type UserPromptsCliRunner = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

/** One scope's on-disk state as read back by the bridge. */
export type PromptScopeState = {
  scope: PromptScope;
  path: string;
  exists: boolean;
  foreign: boolean;
  entries: PromptEntry[];
  bytes: number;
};

/** Reply of prompts_get. */
export type PromptsSnapshot = {
  projectRoot: string | null;
  gitRepo: boolean;
  localExcluded: boolean;
  global: PromptScopeState;
  project: PromptScopeState;
  projectLocal: PromptScopeState;
};

export type UserPromptsStatus = "idle" | "loading" | "ready" | "error";

type UserPromptsState = {
  snapshot: PromptsSnapshot | null;
  status: UserPromptsStatus;
  error: string | null;
  /** In-flight writes keyed by scope, so a section can show a spinner. */
  pending: Partial<Record<PromptScope, true>>;
  /**
   * Load three-scope snapshot via prompts_get.
   * @param runCli Bridge CLI runner.
   * @param opts.force When true, always refetch.
   */
  load: (
    runCli: UserPromptsCliRunner,
    opts?: { force?: boolean },
  ) => Promise<void>;
  /**
   * Full-list write; add/edit/delete funnel through this atomic set.
   * @returns true on success.
   */
  setScope: (
    runCli: UserPromptsCliRunner,
    scope: PromptScope,
    entries: PromptEntry[],
  ) => Promise<boolean>;
  /** Unlink managed file for one scope. */
  clearScope: (
    runCli: UserPromptsCliRunner,
    scope: PromptScope,
  ) => Promise<boolean>;
  /** Atomically move one entry across scopes by index. */
  moveEntry: (
    runCli: UserPromptsCliRunner,
    from: PromptScope,
    to: PromptScope,
    entryIndex: number,
  ) => Promise<boolean>;
  /** Clear error banner. */
  clearError: () => void;
};

/**
 * Coerce unknown CLI data into PromptsSnapshot or null.
 * @param data cli_result.data
 */
export function coercePromptsSnapshot(data: unknown): PromptsSnapshot | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const o = data as Record<string, unknown>;
  const global = coerceScope("global", o.global);
  const project = coerceScope("project", o.project);
  const projectLocal = coerceScope("projectLocal", o.projectLocal);
  if (!global || !project || !projectLocal) {
    return null;
  }
  let projectRoot: string | null = null;
  if (typeof o.projectRoot === "string") {
    projectRoot = o.projectRoot;
  }
  return {
    projectRoot,
    gitRepo: Boolean(o.gitRepo),
    localExcluded: Boolean(o.localExcluded),
    global,
    project,
    projectLocal,
  };
}

/**
 * @param scope Scope id.
 * @param raw Unknown bag.
 */
function coerceScope(
  scope: PromptScope,
  raw: unknown,
): PromptScopeState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const entries = Array.isArray(o.entries)
    ? o.entries.map((e, i) => coerceEntry(e, i))
    : [];
  return {
    scope,
    path: typeof o.path === "string" ? o.path : "",
    exists: Boolean(o.exists),
    foreign: Boolean(o.foreign),
    entries,
    bytes: typeof o.bytes === "number" ? o.bytes : 0,
  };
}

/**
 * @param raw Unknown entry.
 * @param i Fallback id index.
 */
function coerceEntry(raw: unknown, i: number): PromptEntry {
  const o = (raw ?? {}) as Record<string, unknown>;
  const category =
    typeof o.category === "string" && o.category
      ? (o.category as PromptEntry["category"])
      : undefined;
  return {
    id: typeof o.id === "string" && o.id ? o.id : `e${i}`,
    text: String(o.text ?? ""),
    enabled: o.enabled !== false,
    ...(category ? { category } : {}),
  };
}

/**
 * Surface restart banner when a live session is open (rules load at process start).
 */
function notifyRestartIfLive(): void {
  try {
    const s = useSessionStore.getState();
    if (s.connectionMode === "live-bridge" && s.session?.id) {
      useSessionStore.setState({
        restartNotice: "提示词已保存 · 重启会话后生效",
      });
    }
  } catch {
    // session store may be unavailable in pure unit tests — ignore.
  }
}

/**
 * Apply optimistic scope entries onto the current snapshot.
 * Keeps client entry ids so the list does not remount after a successful write
 * (bridge reload would re-parse and mint e0/e1…, killing focus and open menus).
 * @param snap Current snapshot.
 * @param scope Target scope.
 * @param entries New entries (or empty when cleared).
 * @param exists Whether the file still exists.
 * @param bytes Optional on-disk byte length from the write result.
 * @param path Optional absolute path from the write result.
 */
function withScopeEntries(
  snap: PromptsSnapshot,
  scope: PromptScope,
  entries: PromptEntry[],
  exists: boolean,
  bytes?: number,
  path?: string,
): PromptsSnapshot {
  const prev = snap[scope];
  let nextBytes = 0;
  if (typeof bytes === "number") {
    nextBytes = bytes;
  } else if (exists) {
    nextBytes = Math.max(prev.bytes, 1);
  }
  const state: PromptScopeState = {
    ...prev,
    entries,
    exists,
    foreign: false,
    bytes: nextBytes,
    path: typeof path === "string" && path ? path : prev.path,
  };
  return { ...snap, [scope]: state };
}

/**
 * Read path/bytes from a prompts_set / prompts_clear / prompts_move side result.
 * @param data cli_result.data bag.
 */
function writeMeta(data: unknown): { path?: string; bytes?: number; removed?: boolean } {
  if (!data || typeof data !== "object") {
    return {};
  }
  const o = data as Record<string, unknown>;
  return {
    path: typeof o.path === "string" ? o.path : undefined,
    bytes: typeof o.bytes === "number" ? o.bytes : undefined,
    removed: typeof o.removed === "boolean" ? o.removed : undefined,
  };
}

export const useUserPromptsStore = create<UserPromptsState>((set, get) => ({
  snapshot: null,
  status: "idle",
  error: null,
  pending: {},

  clearError: () => set({ error: null }),

  load: async (runCli, opts) => {
    if (!opts?.force && get().status === "loading") {
      return;
    }
    set({ status: "loading", error: null });
    const res = await runCli("prompts_get", {});
    if (!res.ok) {
      set({
        status: "error",
        error: res.error ?? "prompts_get failed",
      });
      return;
    }
    const snap = coercePromptsSnapshot(res.data);
    if (!snap) {
      set({ status: "error", error: "invalid prompts_get payload" });
      return;
    }
    set({ snapshot: snap, status: "ready", error: null });
  },

  setScope: async (runCli, scope, entries) => {
    const prev = get().snapshot;
    if (!prev) {
      set({ error: "prompts not loaded" });
      return false;
    }
    if (prev[scope].foreign) {
      // U-08: refuse set on foreign without calling runCli.
      set({
        error: `${scope} file is external — rename or open it manually`,
      });
      return false;
    }
    set({
      pending: { ...get().pending, [scope]: true },
      error: null,
      // Optimistic update; rollback on failure.
      snapshot: withScopeEntries(prev, scope, entries, entries.length > 0),
    });
    const res = await runCli("prompts_set", { scope, entries });
    const pending = { ...get().pending };
    delete pending[scope];
    if (!res.ok) {
      set({
        snapshot: prev,
        pending,
        error: res.error ?? "prompts_set failed",
      });
      return false;
    }
    // Keep optimistic entries (stable client ids). Only patch path/bytes from bridge.
    const meta = writeMeta(res.data);
    const cur = get().snapshot ?? prev;
    set({
      pending,
      error: null,
      snapshot: withScopeEntries(
        cur,
        scope,
        entries,
        entries.length > 0,
        meta.bytes,
        meta.path,
      ),
    });
    notifyRestartIfLive();
    // Do not prompts_get-reload: re-parse remints ids and steals focus (§6.5 UX).
    return true;
  },

  clearScope: async (runCli, scope) => {
    const prev = get().snapshot;
    if (!prev) {
      set({ error: "prompts not loaded" });
      return false;
    }
    if (prev[scope].foreign) {
      set({
        error: `${scope} file is external — rename or open it manually`,
      });
      return false;
    }
    set({
      pending: { ...get().pending, [scope]: true },
      error: null,
      snapshot: withScopeEntries(prev, scope, [], false),
    });
    const res = await runCli("prompts_clear", { scope });
    const pending = { ...get().pending };
    delete pending[scope];
    if (!res.ok) {
      set({
        snapshot: prev,
        pending,
        error: res.error ?? "prompts_clear failed",
      });
      return false;
    }
    const meta = writeMeta(res.data);
    const cur = get().snapshot ?? prev;
    set({
      pending,
      error: null,
      snapshot: withScopeEntries(cur, scope, [], false, 0, meta.path),
    });
    notifyRestartIfLive();
    return true;
  },

  moveEntry: async (runCli, from, to, entryIndex) => {
    const prev = get().snapshot;
    if (!prev) {
      set({ error: "prompts not loaded" });
      return false;
    }
    if (prev[from].foreign || prev[to].foreign) {
      set({ error: "cannot move involving an external file" });
      return false;
    }
    const fromEntries = prev[from].entries;
    if (entryIndex < 0 || entryIndex >= fromEntries.length) {
      set({ error: "entry index out of range" });
      return false;
    }
    const entry = fromEntries[entryIndex];
    if (!entry) {
      set({ error: "entry index out of range" });
      return false;
    }
    const nextFrom = fromEntries.filter((_, i) => i !== entryIndex);
    const nextTo = [...prev[to].entries, entry];
    let snap = withScopeEntries(prev, from, nextFrom, nextFrom.length > 0);
    snap = withScopeEntries(snap, to, nextTo, true);
    set({
      pending: { ...get().pending, [from]: true, [to]: true },
      error: null,
      snapshot: snap,
    });
    const res = await runCli("prompts_move", { from, to, entryIndex });
    const pending = { ...get().pending };
    delete pending[from];
    delete pending[to];
    if (!res.ok) {
      set({
        snapshot: prev,
        pending,
        error: res.error ?? "prompts_move failed",
      });
      return false;
    }
    // Patch path/bytes from dual write result when present.
    const data = (res.data ?? {}) as Record<string, unknown>;
    const fromMeta = writeMeta(data.from);
    const toMeta = writeMeta(data.to);
    let next = get().snapshot ?? snap;
    next = withScopeEntries(
      next,
      from,
      nextFrom,
      nextFrom.length > 0,
      fromMeta.bytes,
      fromMeta.path,
    );
    next = withScopeEntries(
      next,
      to,
      nextTo,
      true,
      toMeta.bytes,
      toMeta.path,
    );
    set({ pending, error: null, snapshot: next });
    notifyRestartIfLive();
    return true;
  },
}));
