/**
 * Session title helpers — prefer first user prompt over opaque session ids.
 */

import type { SessionState, TimelineItem } from "./types.js";

/** True when title is a weak placeholder (id-based), not a real conversation title. */
export function isWeakSessionTitle(title: string | undefined | null): boolean {
  if (!title || !title.trim()) {return true;}
  const t = title.trim();
  if (t === "New session" || t === "Current chat") {return true;}
  // "Session 019fd6…" / "session 019…" / "Chat 019…"
  if (/^(session|chat)\s+[0-9a-f-]{6,}$/i.test(t)) {return true;}
  // bare uuid-ish / short id
  if (/^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(t)) {return true;}
  if (/^019[0-9a-f-]{10,}$/i.test(t)) {return true;}
  return false;
}

/**
 * Extract display title from timeline: first non-empty user text, else first agent line.
 * Returns empty string if nothing useful (caller may fall back to short id).
 */
export function extractTitleFromTimeline(timeline: TimelineItem[]): string {
  for (const item of timeline) {
    if (item.kind === "user") {
      const text = item.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim()
        .replace(/\s+/g, " ");
      if (text) {return clipTitle(text);}
    }
  }
  for (const item of timeline) {
    if (item.kind === "agent" && item.text.trim()) {
      return clipTitle(item.text.trim().replace(/\s+/g, " "));
    }
  }
  return "";
}

/**
 * Title for a live SessionState.
 * Prefers agent `session_info_update` title, then first user/agent timeline text.
 */
export function titleFromSessionState(state: SessionState): string {
  const agentTitle = state.title?.trim() ?? "";
  if (agentTitle && !isWeakSessionTitle(agentTitle)) {
    return clipTitle(agentTitle);
  }
  return extractTitleFromTimeline(state.timeline);
}

/** Short id label only when no real title exists. */
export function fallbackSessionLabel(id: string): string {
  if (!id) {return "New session";}
  const short = id.length > 12 ? id.slice(0, 8) : id;
  return `Chat ${short}`;
}

function clipTitle(text: string): string {
  return text.length > 56 ? `${text.slice(0, 56)}…` : text;
}

/**
 * Pick best title when upserting catalog: never clobber a good title with id/placeholder.
 * Order: agent session_info title → timeline → existing good title → id fallback.
 */
export function pickSessionTitle(opts: {
  state: SessionState;
  existingTitle?: string;
}): string {
  const fromState = titleFromSessionState(opts.state);
  if (fromState) {return fromState;}
  if (opts.existingTitle && !isWeakSessionTitle(opts.existingTitle)) {
    return opts.existingTitle;
  }
  return fallbackSessionLabel(opts.state.id);
}
