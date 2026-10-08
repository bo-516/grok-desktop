/**
 * Per-session persistence of review comments (localStorage), so drafts
 * survive closing the change panel or switching sessions. Every access is
 * wrapped: private windows / blocked storage degrade to "no saved comments".
 */

import type { ReviewComment, ReviewExcerptLine } from "./reviewComments";

/** Storage key prefix; the session key is appended. */
export const REVIEW_COMMENTS_KEY_PREFIX = "grok-desktop.review-comments.v1:";

/** Hard cap on stored comments per session (keeps the blob small). */
export const REVIEW_COMMENTS_MAX = 100;

/**
 * Key a session's comments are stored under. Draft canvases (no session id
 * yet) key by workspace so comments made before the first send still persist.
 * @param sessionId Live session id ("" for a New chat draft).
 * @param workspace Session workspace (used only for drafts).
 * @returns Session key, or "" when neither is known (nothing is stored).
 */
export function reviewSessionKey(sessionId: string, workspace: string): string {
  const id = sessionId.trim();
  if (id) {
    return id;
  }
  const ws = workspace.trim();
  return ws ? `draft:${ws}` : "";
}

/**
 * Resolve the storage to use.
 * @param storage Explicit storage (tests) or undefined for localStorage.
 * @returns Storage, or null when unavailable / access throws.
 */
function resolveStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage;
  }
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Validate one excerpt line from storage.
 * @param v Unknown value.
 * @returns Line or null.
 */
function parseExcerptLine(v: unknown): ReviewExcerptLine | null {
  if (!v || typeof v !== "object") {
    return null;
  }
  const o = v as Record<string, unknown>;
  if ((o.mark !== "+" && o.mark !== "-" && o.mark !== " ") || typeof o.text !== "string") {
    return null;
  }
  return { mark: o.mark, text: o.text };
}

/**
 * Validate one stored comment; malformed entries are dropped, not repaired.
 * @param v Unknown value.
 * @returns Comment or null.
 */
function parseComment(v: unknown): ReviewComment | null {
  if (!v || typeof v !== "object") {
    return null;
  }
  const o = v as Record<string, unknown>;
  const lines = (Array.isArray(o.excerpt) ? o.excerpt : []).map(parseExcerptLine);
  const valid =
    typeof o.id === "string" &&
    typeof o.path === "string" &&
    o.path !== "" &&
    (o.side === "new" || o.side === "old") &&
    Number.isInteger(o.startLine) &&
    Number.isInteger(o.endLine) &&
    (o.startLine as number) >= 1 &&
    (o.endLine as number) >= (o.startLine as number) &&
    typeof o.body === "string" &&
    o.body.trim() !== "" &&
    lines.every((l) => l !== null);
  if (!valid) {
    return null;
  }
  return {
    id: o.id as string,
    path: o.path as string,
    side: o.side as ReviewComment["side"],
    startLine: o.startLine as number,
    endLine: o.endLine as number,
    excerpt: lines as ReviewExcerptLine[],
    excerptOmitted: Number.isInteger(o.excerptOmitted) ? Math.max(0, o.excerptOmitted as number) : 0,
    body: o.body as string,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
  };
}

/**
 * Parse a stored JSON blob into comments.
 * @param raw Stored string (null → none).
 * @returns Valid comments (bad JSON or shape → []).
 */
export function parseStoredReviewComments(raw: string | null): ReviewComment[] {
  if (!raw) {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map(parseComment)
      .filter((c): c is ReviewComment => c !== null)
      .slice(0, REVIEW_COMMENTS_MAX);
  } catch {
    return [];
  }
}

/**
 * Load a session's saved comments.
 * @param sessionKey Output of reviewSessionKey ("" → []).
 * @param storage Optional storage override (tests).
 * @returns Saved comments, [] when none or storage is unavailable.
 */
export function loadReviewComments(sessionKey: string, storage?: Storage): ReviewComment[] {
  const s = resolveStorage(storage);
  if (!sessionKey || !s) {
    return [];
  }
  try {
    return parseStoredReviewComments(s.getItem(REVIEW_COMMENTS_KEY_PREFIX + sessionKey));
  } catch {
    return [];
  }
}

/**
 * Save (or clear, when empty) a session's comments. Failures are swallowed:
 * the in-memory list stays authoritative for the open panel.
 * @param sessionKey Output of reviewSessionKey ("" → no-op).
 * @param comments Comments to keep (capped at REVIEW_COMMENTS_MAX).
 * @param storage Optional storage override (tests).
 */
export function saveReviewComments(
  sessionKey: string,
  comments: readonly ReviewComment[],
  storage?: Storage,
): void {
  const s = resolveStorage(storage);
  if (!sessionKey || !s) {
    return;
  }
  const key = REVIEW_COMMENTS_KEY_PREFIX + sessionKey;
  try {
    if (comments.length === 0) {
      s.removeItem(key);
      return;
    }
    s.setItem(key, JSON.stringify(comments.slice(0, REVIEW_COMMENTS_MAX)));
  } catch {
    // Quota / blocked storage: keep working in memory.
  }
}
