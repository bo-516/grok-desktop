/**
 * Inbound live SessionState routing: heal → catalog persist → canvas follow.
 * Split from sessionStoreLive so the connect/start module stays under the line limit.
 */

import {
  tagSeedUserMessages,
  type AgentMode,
  type SessionState,
} from "@grok-desktop/acp-core";
import { loadWorkspacePrefs } from "../lib/workspacePrefs";
import {
  normalizeCatalog,
  upsertFromLiveState,
} from "./sessionCatalog";
import { persistNormalizedCatalog } from "./sessionStoreSupport";
import { clearPendingModeTimer } from "./pendingMode";
import {
  mergeCanvasInbound,
  preserveLocalUserMedia,
  resolveCanvasFollow,
} from "./sessionStoreLiveFollow";
import type { ConnectionMode, LiveHandle } from "./sessionStoreLiveTypes";
import type { PoolEntry } from "../bridge/liveBridgeTypes";
import type { EnvironmentInfo } from "../bridge/liveBridgeTypes";

/** Minimal store slice for inbound apply + startLiveBridge. */
export type LiveStoreSlice = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: ReturnType<typeof normalizeCatalog>;
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /** Resident process summaries in the pool (rail status lights). */
  poolEntries: PoolEntry[];
  /** CLI / login probe; null means not received yet. */
  environment: EnvironmentInfo | null;
  /** Queued user prompts while streaming (session-scoped items). */
  promptQueue: {
    sessionId: string;
    text: string;
  }[];
  /** SPAWN restart banner (J-06). */
  restartNotice: string | null;
  /**
   * True after New chat until first send or selectSession.
   * Optional so older call sites still type-check.
   */
  localDraft?: boolean;
  /**
   * True while first send of a New chat draft is forceNew-creating.
   * Optional so older call sites still type-check.
   */
  creatingSession?: boolean;
  /**
   * In-flight mode switch target; cleared when inbound session.mode matches.
   * Optional so older call sites still type-check.
   */
  pendingMode?: AgentMode | null;
  /**
   * Uncached session waiting for session/load replay to land.
   * Optional so older call sites still type-check.
   */
  restoringSessionId?: string | null;
};

export type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;
export type GetState = () => LiveStoreSlice;

/**
 * Heal exact X+X user bodies on any inbound live state before paint/persist.
 * Also coerces fields the wire may omit (go `json:",omitempty"` drops empty
 * lastAgentText) so render helpers that read `.length` never see undefined.
 * @param session Raw ACP session from bridge / pool.
 * @returns Session with tagSeedUserMessages applied to the timeline and
 *   lastAgentText always a string ("" when missing).
 */
export function healSessionTimeline(session: SessionState): SessionState {
  return {
    ...session,
    timeline: tagSeedUserMessages(session.timeline),
    // Empty string is omitted over JSON from bridge-go; keep canvas typed.
    lastAgentText: session.lastAgentText ?? "",
  };
}

/**
 * Route one inbound SessionState (hydrate or post-reduce relay) into catalog + canvas.
 * Shared by full `state` and client-reduced `session_update` so both paths stay identical.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param session SessionState after heal-ready reduce / hydrate.
 */
export function applyInboundSession(
  set: SetState,
  get: GetState,
  session: SessionState,
): void {
  /** Snapshot with legacy duplicate seed rows normalized before routing. */
  const healedTimeline = healSessionTimeline(session);
  // User chose "work without a project": bridge still has a default
  // cwd for the agent process, but do not let that overwrite the UI
  // selection or catalog grouping a few seconds later.
  const healedBase = loadWorkspacePrefs().noProject
    ? { ...healedTimeline, workspace: "" }
    : healedTimeline;
  /**
   * Live reduce only has text echoes of prompts; optimistic paint already
   * holds image ContentBlocks. Merge media onto the same-session canvas
   * before catalog upsert so thumbs survive mid-turn and disk cache.
   */
  const healed = preserveLocalUserMedia(healedBase, get().session);
  /** Shared history receives every session, including background streams. */
  const catalog = normalizeCatalog(
    upsertFromLiveState(get().catalog, healed),
  );
  // Already normalized — skip second full-catalog walk on the hot path.
  persistNormalizedCatalog(catalog);
  /** Explicit rail selection; background pool snapshots must not replace it. */
  const viewing = get().viewingSessionId;
  /** Last canvas-owned live id, used only before an explicit selection exists. */
  const active = get().activeSessionId;
  /** Whether this inbound snapshot may update canvas-scoped state. */
  const follow = resolveCanvasFollow({
    viewing,
    active,
    localDraft: Boolean(get().localDraft),
    creatingSession: Boolean(get().creatingSession),
    inbound: healed,
  });
  // Mode requests belong to the painted chat; a background session
  // using the same mode must not acknowledge the foreground request.
  const pending = get().pendingMode ?? null;
  const modeConfirmed =
    follow && pending !== null && healed.mode === pending;
  if (modeConfirmed) {
    clearPendingModeTimer();
  }
  // Only a canvas-owned snapshot may promote activeSessionId. Keeping
  // background ids out prevents alternating streams from taking turns
  // satisfying the active fallback and repainting the selected chat.
  const nextActive = follow && healed.id ? healed.id : active;
  // Go empty hydrate / short partial reduce must not blank a catalog-seeded
  // canvas; forceNew still keeps optimistic local user bubbles only.
  const canvasSession = follow
    ? mergeCanvasInbound(healed, get().session)
    : healed;
  // Replay landed: the first snapshot for this id that carries content
  // is the single post-load flush. A session that really is empty keeps
  // the hint until the user's first prompt fills the canvas — harmless,
  // and it never hides content that exists.
  const restoreDone =
    get().restoringSessionId === healed.id &&
    healed.timeline.length > 0;
  set({
    catalog,
    activeSessionId: nextActive,
    connectionMode: "live-bridge",
    lastError: null,
    ...(restoreDone ? { restoringSessionId: null } : {}),
    ...(modeConfirmed ? { pendingMode: null } : {}),
    ...(follow
      ? {
          session: canvasSession,
          viewingSessionId: healed.id || viewing,
          // Handshake painted the forceNew session — leave draft mode.
          ...(get().creatingSession && healed.id
            ? { creatingSession: false, localDraft: false }
            : {}),
        }
      : {}),
  });
  // Drain only this session's queue when the followed turn settles (F-STREAM-09).
  // Never deliver prompts enqueued under another sessionId.
  if (healed.status === "idle" && follow && healed.id) {
    const sid = healed.id;
    const idx = get().promptQueue.findIndex((item) => item.sessionId === sid);
    if (idx >= 0) {
      const next = get().promptQueue[idx];
      const rest = [
        ...get().promptQueue.slice(0, idx),
        ...get().promptQueue.slice(idx + 1),
      ];
      set({ promptQueue: rest });
      if (next?.text && get().live) {
        get().live?.prompt(next.text, sid);
      }
    }
  }
}
