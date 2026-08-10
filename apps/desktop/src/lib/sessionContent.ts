/**
 * Whether a session has real conversation content (user or agent messages).
 * Empty drafts / handshake-only timelines are considered empty so the project
 * switcher can still change workspace. Used to lock workspace after the user
 * has started chatting.
 */

import type { TimelineItem } from "@grok-desktop/acp-core";

/**
 * True when the timeline contains at least one user or agent message.
 * Thoughts / tools alone do not lock the workspace (they only appear after a
 * turn starts, which implies a user message first in practice).
 * @param timeline Session timeline items (live or catalog).
 * @returns Whether workspace switching must be locked.
 */
export function sessionHasConversationContent(
  timeline: TimelineItem[] | undefined,
): boolean {
  if (!timeline || timeline.length === 0) {
    return false;
  }
  for (const item of timeline) {
    if (item.kind === "user" || item.kind === "agent") {
      return true;
    }
  }
  return false;
}
