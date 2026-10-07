/**
 * Idle refresh of the session rail from ~/.grok/sessions.
 * The connect path reads once; this interval reads again every
 * {@link CATALOG_REFRESH_IDLE_MS} while no turn is in flight.
 * A busy tick is skipped, not queued, so the next idle tick is the update.
 */

/** Idle rail refresh period. Inside the 10–15s window asked for on open. */
export const CATALOG_REFRESH_IDLE_MS = 12_000;

/**
 * Host interval surface so tests can fire one tick without waiting.
 * Production uses `globalThis.setInterval`.
 */
export type CatalogRefreshHost = {
  /** Arm the repeating tick. Returns an id `clearInterval` understands. */
  setInterval: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Cancel the repeating tick. */
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
};

/** Snapshot for {@link catalogRefreshBusy}. */
export type CatalogRefreshBusySource = {
  /** True while New chat's first send is creating a session. */
  creatingSession?: boolean;
  /** Painted canvas status. */
  sessionStatus?: string;
  /** Pool rows. A live streaming or permission wait counts as busy. */
  poolEntries?: ReadonlyArray<{ live?: boolean; status: string }>;
};

const defaultHost: CatalogRefreshHost = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
};

/** Active timers. Tests replace this; production uses the default host. */
let host: CatalogRefreshHost = defaultHost;

/** Active interval; null when the bridge is down. */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** True while a refresh `sessions_list` is still awaiting the bridge. */
let refreshInFlight = false;

/**
 * Whether this tick should skip the disk read.
 * Busy means a turn is streaming, a tool is waiting for permission, or a
 * New chat is still being created. Idle pool rows do not block the refresh.
 * @param source Canvas and pool snapshot. Omitted fields count as idle.
 * @returns True when the caller should not call `sessions_list`.
 */
export function catalogRefreshBusy(source: CatalogRefreshBusySource): boolean {
  if (source.creatingSession === true) {
    return true;
  }
  if (
    source.sessionStatus === "streaming" ||
    source.sessionStatus === "waiting_permission"
  ) {
    return true;
  }
  const entries = source.poolEntries ?? [];
  for (const entry of entries) {
    if (
      entry.live === true &&
      (entry.status === "streaming" || entry.status === "waiting_permission")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Replace the interval host (tests only). Stops any armed refresh first.
 * @param next Fake host, or null to restore `globalThis` timers.
 */
export function setCatalogRefreshHostForTests(
  next: CatalogRefreshHost | null,
): void {
  stopCatalogRefresh();
  host = next ?? defaultHost;
}

/**
 * Stop the idle rail refresh. Safe when no timer is running.
 * Also drops an in-flight flag so a later connect can read again.
 */
export function stopCatalogRefresh(): void {
  if (refreshTimer !== null) {
    host.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  refreshInFlight = false;
}

/**
 * Start the idle rail refresh. Replaces any timer already armed.
 * Each tick calls `sync` only when `isBusy` is false and no read is in flight.
 * `isBusy` may stop the timer itself when the bridge has disconnected.
 * @param sync One `sessions_list` reconcile. Return value is ignored.
 * @param isBusy True to skip this tick. Called on the interval, not at start.
 */
export function startCatalogRefresh(
  sync: () => Promise<unknown>,
  isBusy: () => boolean,
): void {
  stopCatalogRefresh();
  refreshTimer = host.setInterval(() => {
    if (refreshInFlight || isBusy()) {
      return;
    }
    refreshInFlight = true;
    void sync().finally(() => {
      refreshInFlight = false;
    });
  }, CATALOG_REFRESH_IDLE_MS);
}

/**
 * Store fields the idle tick needs. Structural so this module does not import
 * the session store (that import would cycle through connect → poll → store).
 */
export type CatalogRefreshStore = {
  /** `live-bridge` refreshes; `disconnected` stops the timer; anything else skips. */
  connectionMode?: string;
  /** True during New chat forceNew. */
  creatingSession?: boolean;
  /** Painted canvas. Only `status` is read. */
  session?: { status: string };
  /** Pool snapshot passed to {@link catalogRefreshBusy}. */
  poolEntries?: ReadonlyArray<{ live?: boolean; status: string }>;
};

/**
 * Arm the idle refresh against a live store.
 * Call once the bridge socket is up. The first disk read is the connect-time
 * `sessions_list`; this timer does not fire until {@link CATALOG_REFRESH_IDLE_MS}.
 * @param get Current store snapshot.
 * @param sync `syncCatalogFromBridge` bound to the live handle.
 */
export function armCatalogRefresh(
  get: () => CatalogRefreshStore,
  sync: () => Promise<unknown>,
): void {
  startCatalogRefresh(sync, () => {
    const state = get();
    if (state.connectionMode === "disconnected") {
      stopCatalogRefresh();
      return true;
    }
    if (state.connectionMode !== "live-bridge") {
      return true;
    }
    return catalogRefreshBusy({
      creatingSession: state.creatingSession,
      sessionStatus: state.session?.status,
      poolEntries: state.poolEntries,
    });
  });
}
