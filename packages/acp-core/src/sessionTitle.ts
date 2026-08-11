/**
 * Session title helpers — prefer first user prompt over opaque session ids.
 */

import type { SessionState, TimelineItem } from "./types.js";

/** True when title is a weak placeholder (id-based), not a real conversation title. */
export function isWeakSessionTitle(title: string | undefined | null): boolean {
  if (!title || !title.trim()) {return true;}
  const t = title.trim();
  if (t === "New session" || t === "Current chat") {return true;}
  // Agent / disk summary placeholders that look like real titles but are not.
  if (/^\(?no summary\)?$/i.test(t)) {return true;}
  if (/^untitled( session)?$/i.test(t)) {return true;}
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
        // Agent echoes images as `[Image #N]` — never use that as a title slug.
        .replace(/\[Image\s*#\d+\]/gi, " ")
        .trim()
        .replace(/\s+/g, " ");
      if (text && !isWeakSessionTitle(text)) {
        return clipTitle(text);
      }
    }
  }
  for (const item of timeline) {
    if (item.kind === "agent" && item.text.trim()) {
      const text = item.text
        .trim()
        .replace(/\[Image\s*#\d+\]/gi, " ")
        .replace(/\s+/g, " ");
      if (text && !isWeakSessionTitle(text)) {
        return clipTitle(text);
      }
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

/**
 * Friendly label when no real conversation title exists.
 * Avoids id-shaped "Chat 019fe…" / agent "(no summary)" in the rail.
 * @param _id Session id (kept for call-site stability; not shown).
 */
export function fallbackSessionLabel(_id: string): string {
  return "Untitled chat";
}

/**
 * Clip a conversation title for the rail / top-nav.
 * Keeps more of the first sentence so long task titles stay distinguishable
 * before CSS ellipsis; still bounded so catalog storage stays small.
 * @param text Full candidate title (already whitespace-normalized).
 */
function clipTitle(text: string): string {
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
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
