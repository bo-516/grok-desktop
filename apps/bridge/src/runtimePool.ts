/**
 * Multi-session runtime pool: one ACP session = one grok child process.
 * Idle slots are reclaimed by lastUsed LRU; busy (streaming / waiting_permission) are never evicted.
 * When full and all busy, beginSpawn/insert wait (poll) for room instead of throwing.
 */

import type {
  ContentBlock,
  SessionState,
  SessionStatus,
} from "@grok-desktop/acp-core";
import type { PoolEntry } from "./protocol.js";
import type { SessionSpawnConfig } from "./sessionRuntime.js";

/** How often waiters recheck for idle reclaim while the pool is full. */
const ROOM_POLL_MS = 100;

/**
 * Sleep helper for capacity waiters (does not block the event loop).
 * @param ms Duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** One runtime handle resident in the pool. */
export type PooledRuntime = {
  sessionId: string;
  cwd: string;
  lastUsed: number;
  /** SPAWN flags used at process start (for restart-with-new-config). */
  spawnConfig?: SessionSpawnConfig;
  getStatus: () => SessionStatus;
  getSessionState: () => SessionState;
  prompt: (text: string, blocks?: ContentBlock[]) => Promise<void>;
  cancel: () => void;
  respondPermission: (optionId: string) => void;
  /** Mid-session model switch when ACP supports session/set_model. */
  setModel?: (modelId: string) => Promise<void>;
  /** Mid-session mode switch when ACP supports session/set_mode. */
  setMode?: (modeId: string) => Promise<void>;
  compact?: (instruction?: string) => Promise<void>;
  tokenUsage?: () => Promise<unknown>;
  /**
   * Account billing / weekly remaining via `_x.ai/billing`.
   * @returns Raw grok-build credits-config bag.
   */
  billing?: () => Promise<unknown>;
  /**
   * Branch this session into a peer via `_x.ai/session/fork`.
   * @param opts Optional source/new cwd overrides; defaults to this runtime cwd.
   * @returns Raw agent result containing `newSessionId`.
   */
  forkSession?: (opts?: {
    sourceCwd?: string;
    newCwd?: string;
  }) => Promise<unknown>;
  dispose: () => void;
};

/**
 * Whether a session may be reclaimed by LRU.
 * @param status Current SessionStatus; streaming / waiting_permission / connecting count as busy.
 */
export function isIdleStatus(status: SessionStatus): boolean {
  return status === "idle" || status === "disconnected";
}

/**
 * Pick the sessionId that should be reclaimed (oldest idle by lastUsed).
 * @param entries Current pool snapshot (lastUsed / status).
 * @returns Reclaimable id, or null if no idle entry exists.
 */
export function pickLruIdleVictim(
  entries: Array<{ sessionId: string; lastUsed: number; status: SessionStatus }>,
): string | null {
  const idle = entries
    .filter((e) => isIdleStatus(e.status))
    .sort((a, b) => a.lastUsed - b.lastUsed);
  return idle[0]?.sessionId ?? null;
}

/**
 * RuntimePool: Map insertion order plus delete/re-insert on touch for approximate LRU order.
 * Full + all-busy waits (polls getStatus) instead of throwing.
 */
export class RuntimePool {
  /** Max concurrent resident processes. */
  readonly capacity: number;
  private readonly map = new Map<string, PooledRuntime>();
  /**
   * Spawns in flight that have not yet called insert (or cancelSpawn).
   * Counted against capacity so concurrent start/recovery cannot overshoot.
   */
  private pendingSpawns = 0;
  /** Set by disposeAll so waiters exit instead of blocking forever. */
  private disposed = false;

  /**
   * @param capacity Capacity, at least 1.
   */
  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  /** Current resident count. */
  get size(): number {
    return this.map.size;
  }

  /**
   * Get runtime by sessionId.
   * @param sessionId ACP session id.
   */
  get(sessionId: string): PooledRuntime | undefined {
    return this.map.get(sessionId);
  }

  /** Whether the pool holds a process for the given session. */
  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }

  /**
   * Update lastUsed and move the entry to the Map tail (most recently used).
   * @param sessionId Target session; no-op if missing.
   */
  touch(sessionId: string): void {
    const rt = this.map.get(sessionId);
    if (!rt) {
      return;
    }
    rt.lastUsed = Date.now();
    this.map.delete(sessionId);
    this.map.set(sessionId, rt);
  }

  /**
   * Reserve a pool slot before spawning a child process.
   * Reclaims idle LRU when needed; when all residents are busy, waits until a
   * slot frees (idle reclaim via status poll, or close) or disposeAll runs.
   * Pair with {@link insert} (consumes the reservation) or {@link cancelSpawn}.
   * @throws When the pool was disposed while waiting.
   */
  async beginSpawn(): Promise<void> {
    await this.waitForRoomIncludingPending();
    this.pendingSpawns += 1;
  }

  /**
   * Drop a reservation after spawn/handshake failure (no insert).
   */
  cancelSpawn(): void {
    if (this.pendingSpawns > 0) {
      this.pendingSpawns -= 1;
    }
  }

  /**
   * Insert or replace a runtime; if over capacity, reclaim idle LRU first.
   * Consumes one pending spawn reservation when present.
   * When full and all busy, waits for room (same policy as beginSpawn).
   * @param runtime Handle after handshake (sessionId must be the real ACP id).
   * @throws When the pool was disposed while waiting.
   */
  async insert(runtime: PooledRuntime): Promise<void> {
    if (this.map.has(runtime.sessionId)) {
      const old = this.map.get(runtime.sessionId);
      if (old && old !== runtime) {
        old.dispose();
      }
      this.map.delete(runtime.sessionId);
    }
    // Consume reservation first so ensureCapacity does not count this spawn twice.
    if (this.pendingSpawns > 0) {
      this.pendingSpawns -= 1;
    }
    await this.waitForCapacityForInsert();
    runtime.lastUsed = Date.now();
    this.map.set(runtime.sessionId, runtime);
  }

  /**
   * Close and remove the process for a session.
   * @param sessionId Target id.
   * @returns Whether it previously existed.
   */
  close(sessionId: string): boolean {
    const rt = this.map.get(sessionId);
    if (!rt) {
      return false;
    }
    this.map.delete(sessionId);
    rt.dispose();
    return true;
  }

  /** Close all child processes and mark the pool disposed so waiters exit. */
  disposeAll(): void {
    this.disposed = true;
    for (const rt of this.map.values()) {
      rt.dispose();
    }
    this.map.clear();
    this.pendingSpawns = 0;
  }

  /**
   * List pool summary (LRU: least recently used first).
   */
  list(): PoolEntry[] {
    const entries: PoolEntry[] = [];
    for (const rt of this.map.values()) {
      entries.push({
        sessionId: rt.sessionId,
        cwd: rt.cwd,
        status: rt.getStatus(),
        lastUsed: rt.lastUsed,
        live: true,
      });
    }
    return entries.sort((a, b) => a.lastUsed - b.lastUsed);
  }

  /**
   * Wait until map.size < capacity after reclaiming idle victims.
   * @throws When disposed while waiting.
   */
  private async waitForCapacityForInsert(): Promise<void> {
    for (;;) {
      if (this.disposed) {
        throw new Error("RuntimePool disposed");
      }
      while (this.map.size >= this.capacity) {
        if (!this.reclaimOneIdle()) {
          break;
        }
      }
      if (this.map.size < this.capacity) {
        return;
      }
      await sleep(ROOM_POLL_MS);
    }
  }

  /**
   * Wait until residents + pendingSpawns < capacity after reclaiming idle victims.
   * @throws When disposed while waiting.
   */
  private async waitForRoomIncludingPending(): Promise<void> {
    for (;;) {
      if (this.disposed) {
        throw new Error("RuntimePool disposed");
      }
      while (this.map.size + this.pendingSpawns >= this.capacity) {
        if (!this.reclaimOneIdle()) {
          break;
        }
      }
      if (this.map.size + this.pendingSpawns < this.capacity) {
        return;
      }
      await sleep(ROOM_POLL_MS);
    }
  }

  /**
   * Evict one idle LRU victim.
   * @returns true when a victim was removed; false when all residents are busy.
   */
  private reclaimOneIdle(): boolean {
    const victimId = pickLruIdleVictim(
      [...this.map.values()].map((rt) => ({
        sessionId: rt.sessionId,
        lastUsed: rt.lastUsed,
        status: rt.getStatus(),
      })),
    );
    if (!victimId) {
      return false;
    }
    this.close(victimId);
    return true;
  }
}
