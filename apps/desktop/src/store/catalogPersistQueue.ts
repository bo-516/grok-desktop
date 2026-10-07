/**
 * Catalog "persist" entry points kept for call sites.
 * They do not write localStorage. The rail reads ~/.grok/sessions on connect
 * and on the idle refresh; a local copy outlived deleted grok-build sessions.
 */

import type { SessionRecord } from "./sessionCatalog";

/**
 * Drop any scheduled write. Nothing is scheduled anymore; this clears no timer.
 * Tests still call it between cases.
 */
export function resetCatalogPersistHooksForTests(): void {
  /* no queue */
}

/**
 * Ignored. The queue no longer has a clock.
 * @param _next Former fake clock. Unused.
 */
export function setCatalogPersistClockForTests(_next: unknown): void {
  /* no queue */
}

/**
 * Former immediate localStorage write. Does not touch storage.
 * @param _catalog Ignored snapshot.
 */
export function flushCatalogNow(_catalog?: SessionRecord[]): void {
  /* disk is the source of truth */
}

/**
 * Former throttled localStorage write. Does not touch storage.
 * @param _catalog Ignored snapshot.
 */
export function enqueueCatalogPersist(_catalog: SessionRecord[]): void {
  /* disk is the source of truth */
}
