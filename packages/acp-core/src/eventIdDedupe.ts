/**
 * eventId set-based dedupe for relayed session/update streams.
 *
 * grok-build stamps `_meta.eventId` as `<sessionId>-<seq>` on nearly every
 * update, but seq is **not** strictly monotonic: `task_backgrounded` /
 * `task_completed` can arrive before an earlier `tool_call_update`. A plain
 * watermark (`seq > last`) would drop the reordered tool update; a set of
 * recently seen ids does not.
 */

/**
 * Default ring size: covers reordering windows, long tool-dense turns, and
 * reconnect catch-up. 64 was too small for a single heavy turn (false re-accept
 * after eviction → double-applied agent chunks).
 */
export const DEFAULT_EVENT_ID_RING = 512;

/**
 * Read eventId from notification params or an update object.
 * Accepts params-level `_meta.eventId` (wire shape) and update-level `_meta`.
 * @param params Raw session/update params or update bag.
 * @returns Non-empty eventId string, or null when absent.
 */
export function extractEventId(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }
  const root = params as Record<string, unknown>;
  const fromRoot = eventIdFromMeta(root._meta);
  if (fromRoot) {
    return fromRoot;
  }
  const update = root.update;
  if (update && typeof update === "object") {
    return eventIdFromMeta((update as Record<string, unknown>)._meta);
  }
  return null;
}

/**
 * Pull eventId from a `_meta` record.
 * @param meta Unknown meta bag.
 * @returns Trimmed eventId or null.
 */
function eventIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const id = (meta as Record<string, unknown>).eventId;
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return trimmed ? trimmed : null;
}

/**
 * Mutable ring of recently seen eventIds for one session stream.
 * Callers own one instance per sessionId (or per UI session map entry).
 */
export class EventIdDedupe {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly capacity: number;

  /**
   * @param capacity Max ids retained; oldest dropped first. Must be ≥ 1.
   */
  constructor(capacity: number = DEFAULT_EVENT_ID_RING) {
    this.capacity = capacity < 1 ? DEFAULT_EVENT_ID_RING : capacity;
  }

  /**
   * Whether this eventId was already accepted.
   * @param eventId Candidate id; empty/null treated as never-seen (no dedupe).
   */
  has(eventId: string | null | undefined): boolean {
    if (!eventId) {
      return false;
    }
    return this.seen.has(eventId);
  }

  /**
   * Record an eventId as seen. No-op for empty/null.
   * Evicts oldest when over capacity.
   * @param eventId Id to remember.
   */
  add(eventId: string | null | undefined): void {
    if (!eventId || this.seen.has(eventId)) {
      return;
    }
    this.seen.add(eventId);
    this.order.push(eventId);
    while (this.order.length > this.capacity) {
      const old = this.order.shift();
      if (old) {
        this.seen.delete(old);
      }
    }
  }

  /**
   * Accept only if not yet seen; on accept, mark seen.
   * Events without an id always pass (cannot dedupe safely).
   * @param eventId Candidate from extractEventId.
   * @returns true when the caller should apply the update.
   */
  accept(eventId: string | null | undefined): boolean {
    if (!eventId) {
      return true;
    }
    if (this.seen.has(eventId)) {
      return false;
    }
    this.add(eventId);
    return true;
  }

  /** Number of ids currently retained (for tests). */
  get size(): number {
    return this.seen.size;
  }

  /** Drop all remembered ids (session reset / reconnect hydrate). */
  clear(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
