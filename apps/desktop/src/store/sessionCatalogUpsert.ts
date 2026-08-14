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
  type SessionStatus,
  type TimelineItem,
} from "@grok-desktop/acp-core";
import { preserveLocalUserMedia } from "./sessionStoreLiveFollow";
import type { SessionRecord } from "./sessionCatalogTypes";
import {
  mergeCatalogGoal,
  mergeCatalogMap,
  mergeCatalogTokenUsage,
  trimSubagentCardsForCatalog,
} from "./sessionCatalogMerge";

export {
  CATALOG_SUBAGENT_OUTPUT_MAX,
  mergeCatalogGoal,
  mergeCatalogMap,
  mergeCatalogTokenUsage,
  trimSubagentCardsForCatalog,
} from "./sessionCatalogMerge";

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
 * Ordered user/agent message fingerprints for one timeline (no lastAgentText).
 * Used to distinguish live tip appends from bulk session/load history fills.
 * @param timeline Session timeline (seed-tagged ok).
 * @returns One entry per user or agent row in order.
 */
function conversationMessageParts(timeline: TimelineItem[]): string[] {
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
  return parts;
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
  const parts = conversationMessageParts(timeline);
  parts.push(`lat:${lastAgentText}`);
  return parts.join("\0");
}

/**
 * Whether a content delta looks like a live tip update (one-turn append or
 * in-place agent / attachment growth) rather than a bulk session/load fill.
 * Cold empty → full history is passive; small prefix appends stay live so an
 * idle settle that missed streaming ticks still advances recency.
 * @param existingTimeline Prior catalog timeline.
 * @param existingLat Prior lastAgentText.
 * @param timeline Merged timeline after upsert.
 * @param lastAgentText Merged last agent text.
 * @returns True when wall-clock recency should advance even if status is idle.
 */
function isSmallLiveAppend(
  existingTimeline: TimelineItem[],
  existingLat: string,
  timeline: TimelineItem[],
  lastAgentText: string,
): boolean {
  const oldParts = conversationMessageParts(existingTimeline);
  const newParts = conversationMessageParts(timeline);

  // Empty cache filled by session/load — keep remote-list / prior recency.
  if (oldParts.length === 0) {
    if (newParts.length === 0) {
      return (
        lastAgentText.length > existingLat.length &&
        (existingLat.length === 0 || lastAgentText.startsWith(existingLat))
      );
    }
    return false;
  }

  // Exact prefix: prior messages unchanged, 1–2 new user/agent rows at the tip.
  const isPrefix =
    oldParts.length <= newParts.length &&
    oldParts.every((p, i) => p === newParts[i]);
  if (isPrefix) {
    const added = newParts.length - oldParts.length;
    if (added >= 1 && added <= 2) {
      return true;
    }
    if (added === 0) {
      return (
        lastAgentText.length > existingLat.length &&
        (existingLat.length === 0 || lastAgentText.startsWith(existingLat))
      );
    }
    // added > 2: bulk historical hydrate (select → session/load).
    return false;
  }

  // In-place growth of the last message part (streaming agent text, attach).
  if (oldParts.length === newParts.length) {
    const last = oldParts.length - 1;
    const headMatch = oldParts
      .slice(0, last)
      .every((p, i) => p === newParts[i]);
    const oldTail = oldParts[last] ?? "";
    const newTail = newParts[last] ?? "";
    if (
      headMatch &&
      newTail !== oldTail &&
      newTail.startsWith(oldTail)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Catalog row recency for rail sort: last user/agent message time.
 * Select / reconnect / status-only upserts must not advance the clock
 * (clicking a session must not jump it to the top).
 * Prefer a newer parseable agent `session_info_update.updatedAt` when content
 * is unchanged. When content changes, wall clock advances only for live turns
 * (streaming / waiting_permission) or small tip appends — not bulk session/load.
 * @param existing Prior catalog row, if any.
 * @param timeline Merged timeline after upsert.
 * @param lastAgentText Merged last agent text.
 * @param agentUpdatedAt Optional ISO string from SessionState.updatedAt.
 * @param now Wall-clock ms (injectable for tests).
 * @param status Live session status; idle load hydrates stay passive.
 * @param recency `passive` keeps an existing row's clock (disk hydrate /
 *   session/load replay). Omit / `live` uses the activity rules below.
 * @returns Epoch ms for SessionRecord.updatedAt.
 */
export function resolveCatalogUpdatedAt(
  existing: SessionRecord | undefined,
  timeline: TimelineItem[],
  lastAgentText: string,
  agentUpdatedAt: string | undefined,
  now = Date.now(),
  status?: SessionStatus,
  recency?: "live" | "passive",
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
  // Select / disk hydrate / session/load must not reorder the rail.
  if (recency === "passive") {
    return existing.updatedAt;
  }

  const contentChanged =
    conversationActivityKey(timeline, lastAgentText) !==
    conversationActivityKey(existing.timeline, existing.lastAgentText);

  if (!contentChanged) {
    if (agentMs !== undefined && agentMs > existing.updatedAt) {
      return agentMs;
    }
    return existing.updatedAt;
  }

  // Live turn in flight: wall clock is honest for rail recency.
  const liveTurn =
    status === "streaming" || status === "waiting_permission";
  if (
    liveTurn ||
    isSmallLiveAppend(
      existing.timeline,
      existing.lastAgentText,
      timeline,
      lastAgentText,
    )
  ) {
    return Math.max(now, agentMs ?? 0);
  }

  // Passive hydrate (session/load bulk fill, seed rewrite, idle snapshot):
  // never jump the row to "now" — select must not reorder the rail.
  return existing.updatedAt;
}

/**
 * Merge live ACP state into a catalog record (upsert by session id).
 * Preserves good titles; never replaces them with Session/Chat id labels.
 * `updatedAt` advances only on live user/agent message activity (or a newer
 * agent-reported activity time), not on select/resume bulk hydrates.
 * Role fields (`sessionKind` / `parentSessionId`) come only from disk/list
 * merge — live SessionState has no equivalent — so they are always kept from
 * the existing catalog row when present. Wiping them would re-show harness
 * subagent chats in the rail after drill-down `session/load`.
 * @param catalog Current catalog array (not mutated).
 * @param state Live or seeded SessionState; empty id is a no-op.
 * @param now Wall-clock ms for createdAt / live content-change updatedAt.
 * @param opts `recency: "passive"` for disk hydrate / session/load replay —
 *   never jump an existing row to now (select must not reorder the rail).
 * @returns New catalog sorted by updatedAt desc.
 */
export function upsertFromLiveState(
  catalog: SessionRecord[],
  state: SessionState,
  now = Date.now(),
  opts?: { recency?: "live" | "passive" },
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
  } else if (existing && existing.timeline.length > 0) {
    // Incoming won on length but may be text-only agent echoes — keep catalog
    // image / embed blocks from the prior row for matching user prompts.
    timeline = preserveLocalUserMedia(
      { ...state, timeline: state.timeline },
      { ...state, timeline: existing.timeline },
    ).timeline;
  }
  // Heal pre-fix exact X+X user bodies whenever we persist a catalog row.
  timeline = tagSeedUserMessages(timeline ?? []);
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

  /**
   * "No project" is decided once, when the row is first created: a workspace
   * always arrives on later snapshots (the bridge resolves an empty cwd to its
   * own folder), and while the no-project pref is on every inbound session is
   * masked to "" — re-deriving here would drag real project chats into the
   * no-project section.
   */
  let noProject = existing?.noProject;
  if (!existing && !state.workspace.trim()) {
    noProject = true;
  }

  // Orchestration maps: union with inbound; empty live frames must not wipe
  // catalog cards (same ownership rule as mergeBridgeSnapshot clientMergeMap).
  const subagents = trimSubagentCardsForCatalog(
    mergeCatalogMap(existing?.subagents, state.subagents),
  );
  const subagentLinks = mergeCatalogMap(
    existing?.subagentLinks,
    state.subagentLinks,
  );
  const backgroundTasks = mergeCatalogMap(
    existing?.backgroundTasks,
    state.backgroundTasks,
  );
  const goal = mergeCatalogGoal(existing?.goal, state.goal);
  const tokenUsage = mergeCatalogTokenUsage(
    existing?.tokenUsage,
    state.tokenUsage,
  );

  const next: SessionRecord = {
    id: state.id,
    workspace: state.workspace || existing?.workspace || "",
    title: pickSessionTitle({
      state: mergedState,
      existingTitle: existing?.title,
      titleLocked: existing?.titleLocked,
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
      state.status,
      opts?.recency,
    ),
    timeline,
    toolCalls,
    plan,
    lastAgentText,
    // Live ACP state never carries session_kind; keep disk-merge role fields
    // (retro-tag from sessionRoles may patch these before upsert returns).
    sessionKind: existing?.sessionKind,
    parentSessionId: existing?.parentSessionId,
    // Preserve a user rename across live frames; new rows stay unlocked.
    titleLocked: existing?.titleLocked,
    noProject,
    subagents,
    subagentLinks,
    backgroundTasks,
    goal,
    tokenUsage,
  };
  const without = catalog.filter((s) => s.id !== state.id);
  // Id tie-break keeps sort stable when updatedAt collides (churn reduction).
  return [next, ...without].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

/**
 * Whether two catalogs are reference-equal at every index (same row objects).
 * Used by inbound apply to reuse the prior array when upsert produced no
 * content change, avoiding rail memo churn on every wire frame.
 * @param a Prior catalog array.
 * @param b Candidate catalog array.
 * @returns True when length matches and every slot is the same reference.
 */
export function catalogRefsEqual(
  a: SessionRecord[],
  b: SessionRecord[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
