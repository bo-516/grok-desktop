/**
 * Catalog upsert + recency clock from live SessionState.
 * Pure helpers — no React, no localStorage.
 */

import {
  pickSessionTitle,
  tagSeedUserMessages,
  userTextFromBlocks,
  type ContentBlock,
  type SessionState,
  type TimelineItem,
} from "@grok-desktop/acp-core";
import type { SessionRecord } from "./sessionCatalogTypes";

/**
 * Stable fingerprint of non-text prompt blocks so embed/link/image changes
 * still count as conversation activity without poisoning the display text.
 * @param blocks User prompt content blocks.
 * @returns Compact join of type+identity; empty when only text (or no blocks).
 */
function nonTextBlockActivityKey(blocks: ContentBlock[]): string {
  const bits: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      continue;
    }
    if (b.type === "resource") {
      bits.push(`resource:${b.resource.uri}`);
      continue;
    }
    if (b.type === "resource_link") {
      bits.push(`resource_link:${b.uri}`);
      continue;
    }
    if (b.type === "image") {
      bits.push(`image:${b.mimeType}:${b.data.length}`);
      continue;
    }
    bits.push(`other:${(b as { type: string }).type}`);
  }
  return bits.join("\u001f");
}

/**
 * Fingerprint of user + agent conversation content used to detect real
 * message activity (not select / status / handshake-only upserts).
 * User text uses {@link userTextFromBlocks} only — never concatenates block
 * type names (those leaked into UI when the same join pattern was reused for display).
 * @param timeline Session timeline (seed-tagged ok).
 * @param lastAgentText Accumulated agent text from SessionState.
 * @returns Stable string; equal keys mean no new message content.
 */
function conversationActivityKey(
  timeline: TimelineItem[],
  lastAgentText: string,
): string {
  const parts: string[] = [];
  for (const item of timeline) {
    if (item.kind === "user") {
      const text = userTextFromBlocks(item.blocks);
      const extras = nonTextBlockActivityKey(item.blocks);
      parts.push(extras ? `u:${text}\u001f${extras}` : `u:${text}`);
    } else if (item.kind === "agent") {
      parts.push(`a:${item.text}`);
    }
  }
  parts.push(`lat:${lastAgentText}`);
  return parts.join("\0");
}

/**
 * Catalog row recency for rail sort: last user/agent message time.
 * Select / reconnect / status-only upserts must not advance the clock
 * (clicking a session must not jump it to the top).
 * Prefer a newer parseable agent `session_info_update.updatedAt` when content
 * is unchanged; when content changes use wall clock (and agent time if later).
 * @param existing Prior catalog row, if any.
 * @param timeline Merged timeline after upsert.
 * @param lastAgentText Merged last agent text.
 * @param agentUpdatedAt Optional ISO string from SessionState.updatedAt.
 * @param now Wall-clock ms (injectable for tests).
 * @returns Epoch ms for SessionRecord.updatedAt.
 */
export function resolveCatalogUpdatedAt(
  existing: SessionRecord | undefined,
  timeline: TimelineItem[],
  lastAgentText: string,
  agentUpdatedAt: string | undefined,
  now = Date.now(),
): number {
  const agentMs = (() => {
    if (!agentUpdatedAt?.trim()) {
      return undefined;
    }
    const parsed = Date.parse(agentUpdatedAt);
    return Number.isNaN(parsed) ? undefined : parsed;
  })();

  if (!existing) {
    return agentMs ?? now;
  }

  const contentChanged =
    conversationActivityKey(timeline, lastAgentText) !==
    conversationActivityKey(existing.timeline, existing.lastAgentText);

  if (contentChanged) {
    return Math.max(now, agentMs ?? 0);
  }

  if (agentMs !== undefined && agentMs > existing.updatedAt) {
    return agentMs;
  }
  return existing.updatedAt;
}

/**
 * Merge live ACP state into a catalog record (upsert by session id).
 * Preserves good titles; never replaces them with Session/Chat id labels.
 * `updatedAt` advances only on user/agent message activity (or a newer
 * agent-reported activity time), not on every select/resume upsert.
 * @param catalog Current catalog array (not mutated).
 * @param state Live or seeded SessionState; empty id is a no-op.
 * @param now Wall-clock ms for createdAt / content-change updatedAt.
 * @returns New catalog sorted by updatedAt desc.
 */
export function upsertFromLiveState(
  catalog: SessionRecord[],
  state: SessionState,
  now = Date.now(),
): SessionRecord[] {
  if (!state.id) {
    return catalog;
  }
  const existing = catalog.find((s) => s.id === state.id);
  // Prefer longer timeline (avoid empty handshake clobbering a rich cache)
  const useIncomingTimeline =
    !existing ||
    state.timeline.length >= existing.timeline.length ||
    (state.timeline.length > 0 && existing.timeline.length === 0);

  /** Merge timeline: use inbound when useIncoming; otherwise existing is guaranteed. */
  let timeline = state.timeline;
  if (!useIncomingTimeline && existing) {
    timeline = existing.timeline;
  }
  // Heal pre-fix exact X+X user bodies whenever we persist a catalog row.
  timeline = tagSeedUserMessages(timeline);
  /** Merge toolCalls: prefer full inbound, else non-empty inbound patch, else fall back to cached. */
  let toolCalls = state.toolCalls;
  if (!useIncomingTimeline) {
    if (Object.keys(state.toolCalls).length > 0) {
      toolCalls = state.toolCalls;
    } else if (existing) {
      toolCalls = existing.toolCalls;
    }
  }
  const plan = state.plan && state.plan.length > 0 ? state.plan : existing?.plan;

  const lastAgentText = state.lastAgentText || existing?.lastAgentText || "";
  const mergedState: SessionState = {
    ...state,
    timeline,
    toolCalls,
    plan,
    lastAgentText,
  };

  const next: SessionRecord = {
    id: state.id,
    workspace: state.workspace || existing?.workspace || "",
    title: pickSessionTitle({
      state: mergedState,
      existingTitle: existing?.title,
    }),
    mode: state.mode || existing?.mode || "build",
    model: state.model || existing?.model || "",
    status: state.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: resolveCatalogUpdatedAt(
      existing,
      timeline,
      lastAgentText,
      state.updatedAt,
      now,
    ),
    timeline,
    toolCalls,
    plan,
    lastAgentText,
  };
  const without = catalog.filter((s) => s.id !== state.id);
  return [next, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
}
