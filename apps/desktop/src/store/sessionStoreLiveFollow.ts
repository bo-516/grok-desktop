/**
 * Pure canvas-follow rules for live bridge inbound state.
 * Keeps sessionStoreLive under the line budget and unit-testable without WS.
 *
 * Also owns {@link preserveLocalUserMedia}: live reduce only sees text
 * `user_message_chunk` echoes (`[Image #N]` placeholders), while optimistic
 * paint already holds binary image ContentBlocks. Without a merge step every
 * inbound session_update would replace the canvas and the message-list thumb
 * would vanish mid-turn (and catalog would persist text-only).
 */

import {
  countImagePlaceholders,
  echoRepeatsBody,
  mergeBridgeSnapshot,
  normalizeEchoBody,
  stripImagePlaceholders,
  userImagesFromBlocks,
  userTextFromBlocks,
  type ContentBlock,
  type SessionState,
  type TimelineItem,
} from "@grok-desktop/acp-core";
import { sessionHasConversationContent } from "@/lib/sessionContent";
import {
  applyLockedCatalogTitle,
  type LockedTitleRow,
} from "@/lib/sessionTitleEdit";

/** User timeline row (narrowed for media merge). */
type UserTimelineItem = Extract<TimelineItem, { kind: "user" }>;

/**
 * Non-text ContentBlocks on a user row (images / resource / resource_link).
 * @param blocks User prompt blocks.
 * @returns Blocks that must not be dropped when an agent text-echo overwrites the row.
 */
function nonTextBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.filter((block) => block.type !== "text");
}

/**
 * Whether inbound and local user bodies refer to the same prompt for media merge.
 * Tolerates agent rewrites (`[Image #N]`, whitespace) and image-only locals.
 * @param inboundText Text of the reduced / echoed user row.
 * @param localText Text of the painted optimistic / catalog user row.
 * @param localHasImages True when local already holds binary image blocks.
 * @returns True when media from local may be copied onto inbound.
 */
function userBodiesCompatible(
  inboundText: string,
  localText: string,
  localHasImages: boolean,
): boolean {
  if (
    echoRepeatsBody(inboundText, localText) ||
    echoRepeatsBody(localText, inboundText)
  ) {
    return true;
  }
  // Image-only local: agent echo is often only `[Image #N]` (normalized empty).
  if (localHasImages && normalizeEchoBody(localText).length === 0) {
    return (
      normalizeEchoBody(inboundText).length === 0 ||
      countImagePlaceholders(inboundText) > 0
    );
  }
  return false;
}

/**
 * Restore binary image / embed blocks from the painted local canvas onto
 * inbound user rows that only carry agent text echoes.
 *
 * Live reduce never receives image payloads in `user_message_chunk` — only
 * placeholder text. Optimistic `appendUserPrompt` already painted thumbs; this
 * merge keeps them across every subsequent session_update and catalog upsert.
 *
 * @param inbound Fresh reduced/hydrated session from the bridge.
 * @param local Currently painted canvas (or catalog seed for the same id).
 * @returns Inbound with non-text user blocks restored where texts match; same
 *   reference when nothing changes or sessions differ.
 */
export function preserveLocalUserMedia(
  inbound: SessionState,
  local: SessionState,
): SessionState {
  // Same-id, or draft→forceNew handoff (local still has empty id).
  const sameSession =
    Boolean(inbound.id) && Boolean(local.id) && inbound.id === local.id;
  const draftHandoff = !local.id.trim() && Boolean(inbound.id);
  if (!sameSession && !draftHandoff) {
    return inbound;
  }

  const localUsers = local.timeline.filter(
    (item): item is UserTimelineItem => item.kind === "user",
  );
  if (localUsers.length === 0) {
    return inbound;
  }
  /** Local users that still have media to donate (each used at most once). */
  const mediaPool = localUsers.filter(
    (user) => nonTextBlocks(user.blocks).length > 0,
  );
  if (mediaPool.length === 0) {
    return inbound;
  }

  /**
   * Find a local media-bearing user whose body matches this inbound echo.
   * Prefer exact/prefix text match over pure order — the live reduce bucket
   * often holds only the latest turn while the canvas still has full history,
   * so index pairing would attach media to the wrong (or no) row.
   * @param inboundText Text of the inbound user row (may include `[Image #N]`).
   * @returns Matching local user, or undefined when none left.
   */
  const takeMatchingLocal = (
    inboundText: string,
  ): UserTimelineItem | undefined => {
    const idx = mediaPool.findIndex((localUser) => {
      const localText = userTextFromBlocks(localUser.blocks);
      const localHasImages =
        userImagesFromBlocks(localUser.blocks).length > 0;
      return userBodiesCompatible(inboundText, localText, localHasImages);
    });
    if (idx < 0) {
      return undefined;
    }
    const [match] = mediaPool.splice(idx, 1);
    return match;
  };

  let changed = false;
  const timeline = inbound.timeline.map((item) => {
    if (item.kind !== "user") {
      return item;
    }
    // Inbound already has media — do not clobber wire-authoritative embeds.
    if (nonTextBlocks(item.blocks).length > 0) {
      return item;
    }
    const inboundText = userTextFromBlocks(item.blocks);
    const localUser = takeMatchingLocal(inboundText);
    if (!localUser) {
      return item;
    }
    const localMedia = nonTextBlocks(localUser.blocks);
    // Prefer cleaned inbound wording (agent confirm) without `[Image #N]` noise.
    const cleanText = stripImagePlaceholders(inboundText).trim();
    const textBlocks: ContentBlock[] =
      cleanText.length > 0
        ? [{ type: "text", text: cleanText }]
        : localUser.blocks.filter((block) => block.type === "text");
    changed = true;
    return {
      ...item,
      blocks: [...textBlocks, ...localMedia],
      // Keep local identity so later absorbs still treat this as authoritative.
      origin: localUser.origin ?? item.origin,
      clientPromptId: localUser.clientPromptId ?? item.clientPromptId,
      agentConfirmed: Boolean(item.agentConfirmed || localUser.agentConfirmed),
    };
  });

  if (!changed) {
    return inbound;
  }
  return { ...inbound, timeline };
}

/**
 * Decide whether one inbound session snapshot owns the main canvas.
 * An explicit `viewing` id is an isolation boundary: neither the previously
 * active session nor an id-less handshake may repaint it. `active` is only a
 * fallback before a viewing id exists, and the first inbound snapshot is only
 * accepted when neither focus id exists (cold connect). Passing the wrong
 * focus id therefore keeps the snapshot off-canvas instead of mixing two
 * conversations; draft / forceNew gating is applied separately in
 * {@link resolveCanvasFollow}.
 * @param viewing Explicit session selected in the rail, or null before focus.
 * @param active Last canvas-owned live session, or null on a cold connection.
 * @param sessionId Inbound ACP session id; empty is accepted only without focus.
 * @returns True only when the inbound snapshot owns the current canvas.
 */
export function shouldFollowSession(
  viewing: string | null,
  active: string | null,
  sessionId: string,
): boolean {
  if (viewing !== null) {
    return sessionId === viewing;
  }
  if (active !== null) {
    return sessionId === active;
  }
  return true;
}

/**
 * Whether an inbound live state should repaint the main canvas.
 * Protects the New chat draft (`localDraft`): until the user sends, pool
 * broadcasts from other sessions must not overwrite the empty canvas. While
 * `creatingSession` is true, only a fresh empty session (the forceNew
 * handshake) may take the canvas so a still-streaming previous chat cannot win
 * the race. Cold reconnect has `localDraft === false` so the first inbound
 * session still paints normally.
 * @param args Current canvas focus + inbound session snapshot.
 * @returns True when the inbound session should become the painted canvas.
 */
export function resolveCanvasFollow(args: {
  viewing: string | null;
  active: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  inbound: SessionState;
}): boolean {
  if (args.localDraft) {
    if (!args.creatingSession) {
      return false;
    }
    // Accept only the new empty session — not a background streaming resident.
    return !sessionHasConversationContent(args.inbound.timeline);
  }
  return shouldFollowSession(args.viewing, args.active, args.inbound.id);
}

/**
 * True when a timeline row is an unconfirmed optimistic local user bubble.
 * @param item Timeline entry from the painted canvas.
 * @returns Whether the row should survive an empty forceNew handshake paint.
 */
function isOptimisticLocalUser(item: TimelineItem): boolean {
  return (
    item.kind === "user" &&
    !item.agentConfirmed &&
    (item.origin === "local" || Boolean(item.clientPromptId))
  );
}

/**
 * Keep optimistic local user rows when forceNew paints an empty session.
 * Without this, the canvas flashes empty between "user bubble on draft" and
 * the real bridge prompt state — the user would see their message disappear
 * while create session is still in flight.
 * @param inbound Fresh session from the bridge (usually empty timeline).
 * @param local Currently painted canvas (may already show local user rows).
 * @returns Inbound as-is when it already has conversation content or local has
 *   no optimistic rows; otherwise inbound with local optimistic user rows
 *   appended and status streaming so the Stop chrome stays consistent.
 */
export function mergeOptimisticLocalUsers(
  inbound: SessionState,
  local: SessionState,
): SessionState {
  if (sessionHasConversationContent(inbound.timeline)) {
    return inbound;
  }
  const pending = local.timeline.filter(isOptimisticLocalUser);
  if (pending.length === 0) {
    return inbound;
  }
  return {
    ...inbound,
    timeline: [...inbound.timeline, ...pending],
    status: "streaming",
  };
}

/**
 * Merge one inbound live snapshot onto the painted canvas without blanking
 * a richer same-session cache.
 *
 * Go bridge never holds timeline body text. Pool hit / post-handshake `state`
 * and empty-bucket `session_lifecycle` therefore arrive with `timeline: []`.
 * Catalog/select already painted the full history — replacing it makes
 * refresh look like "content flashes then vanishes".
 *
 * Only empty (no user/agent) same-id inbound is preserved over local body.
 * An empty inbound that is streaming must not promote an idle local
 * transcript — that is how a finished overnight chat painted Responding
 * after session/load metadata. Partial live reduces must still paint so
 * new turns are not dropped; callers seed the reduce bucket from catalog
 * so live updates append to history.
 *
 * Content-rich inbound still runs {@link preserveLocalUserMedia} so image
 * thumbs from optimistic paint survive text-only agent echoes.
 * @param inbound Fresh session from bridge reduce / hydrate.
 * @param local Currently painted canvas (often catalog-seeded on select).
 * @param catalog Optional catalog so a user-locked rail title wins over
 *   inbound `session_info_update` / timeline picks. Omitted in tests.
 * @returns Canvas SessionState safe to write into the store.
 */
export function mergeCanvasInbound(
  inbound: SessionState,
  local: SessionState,
  catalog?: readonly LockedTitleRow[],
): SessionState {
  // Restore image/embed blocks before any empty-vs-rich branch so both
  // paths (keep local body / take inbound) keep message-list thumbs.
  const withMedia = preserveLocalUserMedia(inbound, local);

  const sameSession =
    Boolean(withMedia.id) && Boolean(local.id) && withMedia.id === local.id;
  const localHasBody = sessionHasConversationContent(local.timeline);
  const inboundHasBody = sessionHasConversationContent(withMedia.timeline);

  // Empty same-id hydrate (Go pool / post-handshake): field ownership keeps
  // painted transcript + client-reduced orchestration (subagents, goal, …).
  // Must run before optimistic-user merge so a full local history is not
  // reduced to only unconfirmed bubbles.
  // @see mergeBridgeSnapshot / SESSION_FIELD_OWNER in acp-core
  let next: SessionState;
  if (sameSession && localHasBody && !inboundHasBody) {
    const merged = mergeBridgeSnapshot(local, withMedia);
    // Go never holds timeline. A post-load available_commands / mode frame
    // used to arrive as empty+streaming and steal status (bridge-owned),
    // lighting Responding on yesterday's last agent bubble. An idle canvas
    // that already has the transcript has not started a local turn — keep
    // idle. A real live turn restores via thought/tool/answer chunks or
    // applyPoolBusyToSession when the pool row is actually busy.
    next =
      local.status === "idle" && withMedia.status === "streaming"
        ? { ...merged, status: "idle" }
        : merged;
  } else {
    // forceNew empty handshake: keep unconfirmed local user bubbles only.
    // Content-rich withMedia already carries restored image blocks; still run
    // ownership merge so Node non-empty snapshots cannot wipe orchestration.
    const withOptimistic = mergeOptimisticLocalUsers(withMedia, local);
    next = mergeBridgeSnapshot(local, withOptimistic);
  }
  return applyLockedCatalogTitle(next, catalog);
}
