/**
 * Tail-throttled catalog localStorage writer.
 * In-memory catalog stays up to date on every update; only disk I/O is coalesced
 * so a long session/load replay does not block the main thread with hundreds of
 * synchronous setItem calls. Call flushCatalogNow on visibility hidden,
 * beforeunload, and session switch so the latest snapshot is not lost.
 */

import {
  saveCatalogToStorage,
  type SessionRecord,
} from "./sessionCatalog";

/** Minimum quiet window between localStorage writes (ms). */
export const CATALOG_PERSIST_THROTTLE_MS = 1000;

/**
 * Injectable clock for unit tests (fake timers).
 * Production uses real Date.now / setTimeout / clearTimeout.
 */
export type CatalogPersistClock = {
  /** Wall-clock ms; used to decide whether a write is still inside the throttle window. */
  now: () => number;
  /** Schedule a delayed flush; must return a handle clearTimeout understands. */
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a pending delayed flush. */
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

/** Production clock bound to the real global timers. */
const defaultClock: CatalogPersistClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

/** Active clock; tests may replace via setCatalogPersistClockForTests. */
let clock: CatalogPersistClock = defaultClock;

/** Latest catalog waiting to be written; null when nothing is pending. */
let pendingCatalog: SessionRecord[] | null = null;

/** Handle for the scheduled tail flush; null when no timer is armed. */
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Timestamp of the last successful disk write (ms).
 * Seeded to -throttle so the first enqueue always writes immediately
 * even when the clock starts at 0 (fake timers).
 */
let lastWriteAt = -CATALOG_PERSIST_THROTTLE_MS;

/** Whether document visibility / beforeunload hooks are installed. */
let hooksInstalled = false;

/**
 * Replace the clock used by the queue (tests only).
 * Pass null to restore the production clock and clear pending work.
 * @param next Fake clock, or null to reset to defaults and drop pending state.
 */
export function setCatalogPersistClockForTests(
  next: CatalogPersistClock | null,
): void {
  if (pendingTimer !== null) {
    clock.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingCatalog = null;
  lastWriteAt = -CATALOG_PERSIST_THROTTLE_MS;
  clock = next ?? defaultClock;
}

/**
 * Write `catalog` to localStorage immediately and clear any pending throttle.
 * Used by visibility/beforeunload hooks, session switch, and tests.
 * @param catalog Optional override; when omitted, flushes the pending snapshot if any.
 */
export function flushCatalogNow(catalog?: SessionRecord[]): void {
  const toWrite = catalog ?? pendingCatalog;
  if (pendingTimer !== null) {
    clock.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingCatalog = null;
  if (!toWrite) {
    return;
  }
  saveCatalogToStorage(toWrite);
  lastWriteAt = clock.now();
}

/**
 * Schedule a tail-throttled localStorage write of `catalog`.
 * Multiple calls within CATALOG_PERSIST_THROTTLE_MS keep only the latest catalog.
 * @param catalog Already-normalized records to persist (last write wins).
 */
export function enqueueCatalogPersist(catalog: SessionRecord[]): void {
  ensurePersistHooks();
  pendingCatalog = catalog;
  const now = clock.now();
  const elapsed = now - lastWriteAt;
  if (elapsed >= CATALOG_PERSIST_THROTTLE_MS && pendingTimer === null) {
    // Outside the quiet window and nothing scheduled: write immediately.
    flushCatalogNow(catalog);
    return;
  }
  if (pendingTimer !== null) {
    // Timer already armed; pendingCatalog was updated above — last wins.
    return;
  }
  // Inside the window: arm a single tail timer for the remaining quiet time.
  const delay = Math.max(0, CATALOG_PERSIST_THROTTLE_MS - elapsed);
  pendingTimer = clock.setTimeout(() => {
    pendingTimer = null;
    flushCatalogNow();
  }, delay);
}

/**
 * Install one-shot browser hooks so a hidden tab or unload flushes the queue.
 * No-ops outside a browser document (Node tests).
 */
function ensurePersistHooks(): void {
  if (hooksInstalled) {
    return;
  }
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  hooksInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushCatalogNow();
    }
  });
  window.addEventListener("beforeunload", () => {
    flushCatalogNow();
  });
}

/**
 * Test helper: drop hooks flag so a suite can re-install cleanly.
 * Does not remove real DOM listeners (tests usually lack a document).
 */
export function resetCatalogPersistHooksForTests(): void {
  hooksInstalled = false;
  if (pendingTimer !== null) {
    clock.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingCatalog = null;
  lastWriteAt = -CATALOG_PERSIST_THROTTLE_MS;
}
