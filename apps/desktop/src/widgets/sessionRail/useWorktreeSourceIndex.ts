/**
 * Map worktree checkouts back to their source repo for rail grouping.
 * Rows that already carry `worktree.sourceRepo` are left alone. Other
 * workspaces are probed once via `workspace_git` and cached, including
 * a negative answer so a normal clone is not asked again.
 */

import { useEffect, useMemo, useState } from "react";
import {
  canonicalProjectPath,
  type WorktreeSourceCacheEntry,
} from "@/lib/worktreeChat";
import {
  loadWorktreeSourceCache,
  overlayWorktreeSources,
  saveWorktreeSourceCache,
  sourceCacheFromProbe,
  sourceCacheHas,
} from "@/lib/worktreeChatCatalog";
import type { SessionRecord } from "@/store/sessionCatalog";

/** `runCli` shape the session store exposes. */
type RunCli = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

/**
 * Overlay source repos onto catalog rows and probe unknown paths while
 * the bridge is live.
 * A bridge that is down returns the cache overlay only — no CLI calls.
 * @param catalog Visible catalog (already filtered for removed projects).
 * @param runCli Live CLI channel. Ignored when `live` is false.
 * @param live True when `connectionMode` is `live-bridge`.
 * @returns Rows safe to group. Same reference when the cache adds nothing.
 */
export function useWorktreeSourceIndex(
  catalog: SessionRecord[],
  runCli: RunCli,
  live: boolean,
): SessionRecord[] {
  const [cache, setCache] = useState<Record<string, WorktreeSourceCacheEntry>>(
    () => loadWorktreeSourceCache(),
  );

  const pendingKey = useMemo(() => {
    const paths = new Set<string>();
    for (const rec of catalog) {
      if (rec.worktree?.sourceRepo) {
        continue;
      }
      const path = rec.workspace.trim();
      if (!path || sourceCacheHas(cache, path)) {
        continue;
      }
      paths.add(path);
    }
    return [...paths].sort().join("\n");
  }, [catalog, cache]);

  useEffect(() => {
    if (!live || !pendingKey) {
      return;
    }
    let cancelled = false;
    const paths = pendingKey.split("\n");
    void (async () => {
      const updates: Record<string, WorktreeSourceCacheEntry> = {};
      for (const path of paths) {
        if (cancelled) {
          return;
        }
        const result = await runCli("workspace_git", { path });
        if (cancelled) {
          return;
        }
        updates[canonicalProjectPath(path)] = sourceCacheFromProbe(path, result);
      }
      if (cancelled) {
        return;
      }
      setCache((prev) => {
        const next = { ...prev, ...updates };
        saveWorktreeSourceCache(next);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [live, pendingKey, runCli]);

  return useMemo(
    () => overlayWorktreeSources(catalog, cache),
    [catalog, cache],
  );
}
