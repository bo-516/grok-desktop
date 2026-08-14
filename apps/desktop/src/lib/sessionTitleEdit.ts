/**
 * Session rail rename helpers.
 * Sanitize a typed title, apply it to the catalog (locking against agent /
 * timeline overwrite), and re-stamp a locked title onto a live canvas snapshot.
 */

import {
  displaySessionTitle,
  fallbackSessionLabel,
  type SessionState,
} from "@grok-desktop/acp-core";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Max stored characters for a user-chosen rail title.
 * Matches {@link clipTitle} in acp-core so catalog rows stay small; the rail
 * still CSS-ellipsizes anything that does not fit the row.
 */
export const SESSION_TITLE_MAX_LEN = 72;

/** Minimal catalog shape needed to restore a locked title onto the canvas. */
export type LockedTitleRow = {
  /** Session id the lock belongs to. */
  id: string;
  /** Locked display title (already persisted). */
  title: string;
  /** True when the user chose this title and live upserts must not replace it. */
  titleLocked?: boolean;
};

/**
 * Normalize a typed rename: collapse whitespace, trim, clip to max length.
 * Empty / whitespace-only input becomes "" so the caller can cancel.
 * @param raw Input value from the rail title field.
 * @returns Safe catalog title, or empty when the user cleared the field.
 */
export function sanitizeSessionTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) {
    return "";
  }
  return t.length > SESSION_TITLE_MAX_LEN
    ? t.slice(0, SESSION_TITLE_MAX_LEN)
    : t;
}

/**
 * Rail / tooltip label for a catalog row.
 * A locked title is shown as typed (even if it would look "weak" to the
 * auto-namer); unlocked rows still rewrite placeholders via displaySessionTitle.
 * @param rec Catalog row (title + optional lock).
 * @returns Text to paint on the session row.
 */
export function railSessionTitle(rec: {
  title: string;
  titleLocked?: boolean;
}): string {
  if (rec.titleLocked) {
    const t = rec.title.trim();
    return t || fallbackSessionLabel("");
  }
  return displaySessionTitle(rec.title);
}

/**
 * Write a user-chosen title onto one catalog row and lock it.
 * Unknown ids and empty sanitized titles leave the catalog reference unchanged.
 * Same title that is already locked is also a no-op (stable reference).
 * Does not bump `updatedAt` — rename is metadata, not conversation activity.
 * @param catalog Current catalog.
 * @param id Session to rename.
 * @param nextTitle Raw or already-sanitized title from the rail input.
 * @returns Next catalog array, or the same reference when nothing changed.
 */
export function renameCatalogSession(
  catalog: SessionRecord[],
  id: string,
  nextTitle: string,
): SessionRecord[] {
  const title = sanitizeSessionTitle(nextTitle);
  if (!title) {
    return catalog;
  }
  let changed = false;
  const next = catalog.map((rec) => {
    if (rec.id !== id) {
      return rec;
    }
    if (rec.title === title && rec.titleLocked) {
      return rec;
    }
    changed = true;
    return { ...rec, title, titleLocked: true };
  });
  return changed ? next : catalog;
}

/**
 * Re-apply a user-locked catalog title onto a canvas SessionState.
 * Inbound `session_info_update` / timeline picks must not replace a rename.
 * Missing catalog, unlocked rows, and already-matching titles return `session`.
 * @param session Canvas or inbound snapshot (id selects the catalog row).
 * @param catalog Optional rows to read the lock from; omitted = no-op.
 * @returns Session with `title` forced to the locked value when applicable.
 */
export function applyLockedCatalogTitle(
  session: SessionState,
  catalog: readonly LockedTitleRow[] | undefined,
): SessionState {
  if (!catalog || !session.id) {
    return session;
  }
  const rec = catalog.find((row) => row.id === session.id);
  if (!rec?.titleLocked) {
    return session;
  }
  const locked = rec.title.trim();
  if (!locked || session.title === locked) {
    return session;
  }
  return { ...session, title: locked };
}
