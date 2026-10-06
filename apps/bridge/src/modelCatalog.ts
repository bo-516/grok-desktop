/**
 * Initialize-only model catalog read.
 * A New chat has no session, so the composer cannot see models that only
 * arrive inside session/new. When the pool already holds a catalog, that
 * snapshot is returned and no second process is started. Otherwise this
 * spawns a short-lived `grok agent stdio`, sends initialize, and disposes
 * the process. It does not call session/new (that would create a ghost chat).
 */

import {
  AcpClient,
  extractInitializeSessionMetadata,
  type AvailableModel,
  type InitializeResult,
  type SessionState,
} from "@grok-desktop/acp-core";
import type { RuntimePool } from "./runtimePool.js";
import { spawnGrokAgent } from "./spawnGrok.js";

/** How long to wait for an in-flight handshake before probing. */
const POOL_WAIT_MS = 8_000;
/** Gap between pool snapshots while a handshake is in flight. */
const POOL_POLL_MS = 200;
/** Bound on the initialize RPC. Desktop times the whole request out at 40s. */
const PROBE_TIMEOUT_MS = 25_000;

/** Picker snapshot. configOptions is empty when the source is initialize only. */
export type ModelCatalogSnapshot = {
  /** Agent current model id. Empty when initialize omitted it. */
  model: string;
  /** Normalized catalog. Empty when the agent advertised nothing. */
  availableModels: AvailableModel[];
  /** Session config selects. Empty on the initialize-only path. */
  configOptions: unknown[];
};

/**
 * True when a resident or an in-flight spawn might still publish models.
 * An empty pool with no pending spawn must probe immediately.
 * @param residentCount Sessions already in the pool.
 * @param pendingSpawns BeginSpawn reservations not yet inserted.
 */
export function poolNeedsCatalogWait(
  residentCount: number,
  pendingSpawns: number,
): boolean {
  return residentCount > 0 || pendingSpawns > 0;
}

/**
 * Pick a resident snapshot that has models.
 * Among several, one that also carries configOptions wins so the composer
 * sees reasoning_effort currentValue when any live session has it.
 * @param states Resident snapshots. Rows without models are skipped.
 * @returns Snapshot, or null when every resident is still empty.
 */
export function pickPoolCatalog(
  states: SessionState[],
): ModelCatalogSnapshot | null {
  let found: ModelCatalogSnapshot | null = null;
  for (const state of states) {
    if (!state.availableModels?.length) {
      continue;
    }
    const config = Array.isArray(state.configOptions) ? state.configOptions : [];
    if (!found || (found.configOptions.length === 0 && config.length > 0)) {
      found = {
        model: state.model || "",
        availableModels: state.availableModels,
        configOptions: config,
      };
    }
  }
  return found;
}

/**
 * Return a pooled catalog, waiting only while a handshake is in flight.
 * @param pool Resident sessions. Empty + idle returns null immediately.
 * @param waitMs Max wait. Zero still checks once.
 * @returns Snapshot, or null when the caller should probe initialize.
 */
export async function waitForPoolCatalog(
  pool: RuntimePool,
  waitMs: number,
): Promise<ModelCatalogSnapshot | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = pickPoolCatalog(pool.sessionStates());
    if (found) {
      return found;
    }
    const residentCount = pool.sessionStates().length;
    const pending = pool.pendingSpawnCount();
    if (!poolNeedsCatalogWait(residentCount, pending) || Date.now() >= deadline) {
      return null;
    }
    await delay(POOL_POLL_MS);
  }
}

/**
 * Read the catalog from the pool or from a disposable initialize.
 * @param pool Live sessions. A catalog already on a resident skips the spawn.
 * @param cwd Working directory for the probe child. Empty uses ".".
 * @returns Snapshot. availableModels may be empty when the agent omitted them;
 *          that is not an error. Spawn and initialize failures reject.
 */
export async function readModelCatalog(
  pool: RuntimePool,
  cwd: string,
): Promise<ModelCatalogSnapshot> {
  const pooled = await waitForPoolCatalog(pool, POOL_WAIT_MS);
  if (pooled) {
    return pooled;
  }
  return probeInitializeCatalog(cwd || ".");
}

/**
 * Spawn grok, initialize, dispose. No authenticate and no session/new.
 * @param cwd Child working directory. Must be usable by the grok process.
 * @returns Model id and catalog from initialize `_meta.modelState`.
 */
async function probeInitializeCatalog(cwd: string): Promise<ModelCatalogSnapshot> {
  const agent = spawnGrokAgent({ cwd });
  const client = new AcpClient({ transport: agent.transport });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const init = await Promise.race([
      client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("initialize timed out")),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    const meta = extractInitializeSessionMetadata(init as InitializeResult);
    return {
      model: meta.model,
      availableModels: meta.availableModels,
      configOptions: [],
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    client.dispose();
    agent.dispose();
  }
}

/**
 * @param ms Delay in milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
