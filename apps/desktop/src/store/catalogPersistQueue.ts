/**
 * Tail-throttled catalog localStorage writer.
 * In-memory catalog stays up to date on every update; only disk I/O is coalesced
 * so a long session/load replay does not block the main thread with hundreds of
 * synchronous setItem calls. Call flushCatalogNow on visibility hidden,
 * beforeunload, and session switch so the latest snapshot is not lost.
 *
 * `enqueueCatalogPersist` NEVER writes synchronously. A full catalog is
 * JSON.stringify + setItem of megabytes (≈5ms at 450 sessions), and the enqueue
 * call sites are the interactive ones — first send of a New chat, the forceNew
 * handshake, every inbound session update. Writing inline put that ~5ms inside
 * the same task as the store update that starts the send animations, which drops
 * the frame and shows up as the whole shell (rail included) stuttering. The
 * write is now always scheduled: tail-throttled onto a timer, then handed to an
 * idle callback so it lands between frames instead of in front of one.
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
  /**
   * Run the write when the browser is idle. Optional: a clock without it (the
   * fake clocks in tests) runs the write straight from the throttle timer.
   */
  requestIdle?: (fn: () => void) => void;
};

/** Production clock bound to the real global timers. */
const defaultClock: CatalogPersistClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  /**
   * `timeout` caps the wait so a busy tab still persists; the setTimeout branch
   * covers shells without requestIdleCallback (older WKWebView).
   */
  requestIdle: (fn) => {
    const ric = (
      globalThis as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number },
        ) => unknown;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(fn, { timeout: CATALOG_PERSIST_THROTTLE_MS });
      return;
    }
    globalThis.setTimeout(fn, 0);
  },
};

/** Active clock; tests may replace via setCatalogPersistClockForTests. */
let clock: CatalogPersistClock = defaultClock;

/** Latest catalog waiting to be written; null when nothing is pending. */
let pendingCatalog: SessionRecord[] | null = null;

/** Handle for the scheduled tail flush; null when no timer is armed. */
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * True between the throttle timer firing and the idle write running. Keeps
 * `enqueueCatalogPersist` from arming a second timer for a write that is
 * already on its way — the pending catalog is replaced instead.
 */
let idleQueued = false;

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
  idleQueued = false;
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
  idleQueued = false;
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
 *
 * Always asynchronous — see the module header: the caller is on the send /
 * inbound-update path and must not pay for a multi-megabyte serialize.
 * @param catalog Already-normalized records to persist (last write wins).
 */
export function enqueueCatalogPersist(catalog: SessionRecord[]): void {
  ensurePersistHooks();
  pendingCatalog = catalog;
  if (pendingTimer !== null || idleQueued) {
    // A write is already on its way; pendingCatalog was updated above — last wins.
    return;
  }
  // Outside the quiet window the delay is 0, but the write still leaves this
  // task: the point is to keep it out of the frame that started the update.
  const delay = Math.max(0, CATALOG_PERSIST_THROTTLE_MS - (clock.now() - lastWriteAt));
  pendingTimer = clock.setTimeout(() => {
    pendingTimer = null;
    const idle = clock.requestIdle;
    if (!idle) {
      flushCatalogNow();
      return;
    }
    idleQueued = true;
    idle(() => {
      if (idleQueued) {
        flushCatalogNow();
      }
    });
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
  idleQueued = false;
  pendingCatalog = null;
  lastWriteAt = -CATALOG_PERSIST_THROTTLE_MS;
}
