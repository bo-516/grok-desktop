/**
 * Session title helpers — prefer first real user prompt over opaque ids
 * and over grok-build harness leftovers (`Goal: @file.md`, status words).
 */

import type { SessionState, TimelineItem } from "./types.js";

/** Status words grok-build writes to `session_info_update.title` mid-turn. */
const TRANSIENT_AGENT_TITLE =
  /^(working|thinking|generating|streaming|idle|responding)(\s*[.…]+)?$/i;

/**
 * True when the string is a Goal-mode harness injection, not a conversation
 * title. Matches the sanitized `Goal: @path.md` echo and a bare `Goal: file.md`.
 * Ordinary `Goal: ship the login form` text is left alone.
 * @param title Candidate rail / top-nav title or user-bubble body.
 */
export function isHarnessGoalTitle(title: string | undefined | null): boolean {
  if (!title) {
    return false;
  }
  const t = title.trim();
  if (!t) {
    return false;
  }
  if (/^Goal:\s*@\S+/i.test(t)) {
    return true;
  }
  return /^Goal:\s+\S+\.md\s*$/i.test(t);
}

/**
 * True when title is a weak placeholder (id, status word, Goal file), not a
 * real conversation title. Callers must not persist these as the catalog name.
 * @param title Raw catalog / agent / timeline title; empty is weak.
 */
export function isWeakSessionTitle(title: string | undefined | null): boolean {
  if (!title || !title.trim()) {
    return true;
  }
  const t = title.trim();
  if (t === "New session" || t === "Current chat") {
    return true;
  }
  // Agent / disk summary placeholders that look like real titles but are not.
  if (/^\(?no summary\)?$/i.test(t)) {
    return true;
  }
  // "Untitled" / "Untitled chat" / "Untitled session" — fallbackSessionLabel
  // and row display both use "Untitled chat"; treat as empty-draft placeholders.
  if (/^untitled(\s+(session|chat))?$/i.test(t)) {
    return true;
  }
  // "Session 019fd6…" / "session 019…" / "Chat 019…"
  if (/^(session|chat)\s+[0-9a-f-]{6,}$/i.test(t)) {
    return true;
  }
  // bare uuid-ish / short id
  if (/^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(t)) {
    return true;
  }
  if (/^019[0-9a-f-]{10,}$/i.test(t)) {
    return true;
  }
  if (TRANSIENT_AGENT_TITLE.test(t)) {
    return true;
  }
  if (isHarnessGoalTitle(t)) {
    return true;
  }
  return false;
}

/**
 * Basename of a Goal-mode `@path.md` injection, for when the timeline has
 * no later human prompt to use as the session name.
 * @param title Harness `Goal: @…` line; other strings return empty.
 * @returns File stem without `@` / `.md`, or empty when it is not a Goal file.
 */
export function cleanHarnessGoalTitle(
  title: string | undefined | null,
): string {
  if (!title || !isHarnessGoalTitle(title)) {
    return "";
  }
  let t = title.trim().replace(/^Goal:\s*/i, "");
  t = t.replace(/^@/, "");
  const base = t.split(/[/\\]/).pop() ?? t;
  return base.replace(/\.md$/i, "").trim();
}

/**
 * Leading 8 characters of a session id for chrome that must stay unique when
 * several chats share a Goal file or generated title.
 * @param id Full session id; empty / missing yields an empty chip.
 */
export function shortSessionId(id: string | undefined | null): string {
  const t = (id ?? "").trim();
  if (!t) {
    return "";
  }
  return t.slice(0, 8);
}

/**
 * Rail / top-nav label for a stored title: rewrite weak placeholders so the
 * UI never shows `(no summary)`, `Chat 019fe…`, or `Goal: @file.md` as the
 * primary name. A Goal file degrades to its stem instead of "Untitled chat".
 * @param raw Catalog title from disk / agent / local upsert.
 */
export function displaySessionTitle(raw: string | undefined | null): string {
  const t = (raw ?? "").trim();
  if (!t || isWeakSessionTitle(t)) {
    const cleaned = cleanHarnessGoalTitle(t);
    return cleaned || fallbackSessionLabel("");
  }
  return t;
}

/**
 * Extract display title from timeline: first real user text, else a cleaned
 * Goal file stem, else the first agent line.
 * Harness `Goal: @file.md` rows are skipped so a later human prompt becomes
 * the session name (otherwise every Goal-mode chat looks identical).
 * @param timeline Session timeline in paint order.
 * @returns Clipped title, or empty when nothing useful exists.
 */
export function extractTitleFromTimeline(timeline: TimelineItem[]): string {
  /** Stem of the first Goal injection; used only when no human prompt exists. */
  let goalFallback = "";
  for (const item of timeline) {
    if (item.kind !== "user") {
      continue;
    }
    const text = item.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      // Agent echoes images as `[Image #N]` — never use that as a title slug.
      .replace(/\[Image\s*#\d+\]/gi, " ")
      .trim()
      .replace(/\s+/g, " ");
    if (!text) {
      continue;
    }
    if (isHarnessGoalTitle(text)) {
      if (!goalFallback) {
        goalFallback = cleanHarnessGoalTitle(text);
      }
      continue;
    }
    if (!isWeakSessionTitle(text)) {
      return clipTitle(text);
    }
  }
  if (goalFallback) {
    return clipTitle(goalFallback);
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
 * Prefers a non-weak agent `session_info_update` title, then timeline text
 * (skipping Goal injections and status words such as `Working`).
 * @param state Live or catalog-hydrated session; `title` may be absent.
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
 * Order: user-locked title → agent session_info title → timeline → existing
 * good title → id fallback. A locked title wins even when the agent later
 * emits a stronger `session_info_update` or the first prompt changes.
 * @param opts Live state plus the catalog title already stored for this id.
 */
export function pickSessionTitle(opts: {
  state: SessionState;
  existingTitle?: string;
  /**
   * True when the user renamed this chat. Locked titles must survive live
   * upserts; omit / false keeps the auto-namer.
   */
  titleLocked?: boolean;
}): string {
  if (opts.titleLocked) {
    const locked = opts.existingTitle?.trim() ?? "";
    if (locked) {
      return locked;
    }
  }
  const fromState = titleFromSessionState(opts.state);
  if (fromState) {
    return fromState;
  }
  if (opts.existingTitle && !isWeakSessionTitle(opts.existingTitle)) {
    return opts.existingTitle;
  }
  return fallbackSessionLabel(opts.state.id);
}
