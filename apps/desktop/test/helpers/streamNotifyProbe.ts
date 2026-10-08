/**
 * Store-notification probe for live streaming. Drives the shipped
 * createLiveBridgeDispatch (no WebSocket) → applyLiveInboundSession (the
 * live apply site sessionStoreLive wires) → a real zustand vanilla store,
 * and counts subscriber notifications for N chunks across K sessions.
 * `coalesce: false` is the pre-coalescing baseline (synchronous notify).
 */

import { createStore } from "zustand/vanilla";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "@/bridge/liveBridgeDispatch";
import type { BridgeServerMsg } from "@/bridge/liveBridgeTypes";
import type { PromptQueueItem } from "@/lib/promptQueue";
import { shouldFollowSession } from "@/store/sessionStoreLiveFollow";
import { applyLiveInboundSession } from "@/store/sessionStoreLiveApply";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { SessionRoleIndex } from "@/store/sessionRoles";
import { forgetAllTurnEdges } from "@/store/sessionTurnEdge";
import { createFakeFrameClock } from "./fakeFrameClock.js";

/** Probe knobs. */
export type StreamProbeOpts = {
  /** Session id prefix; keep unique per run (token-usage latch is global). */
  label: string;
  /** K: concurrently streaming sessions; session 0 is the viewed one. */
  sessions: number;
  /** N: agent_message_chunk updates per session. */
  chunksPerSession: number;
  /** Wire spacing between chunks of one session (ms of virtual time). */
  chunkIntervalMs: number;
  /** True → shipped coalescing; false → synchronous baseline. */
  coalesce: boolean;
  /** Turns per session (default 1); one queued follow-up per turn on session 0. */
  turns?: number;
};

/** Probe measurements. */
export type StreamProbeResult = {
  /** zustand subscriber notifications from turn start through settle. */
  storeNotifications: number;
  /** Relay notifies (onState + onSessionUpdate) over the same span. */
  handlerNotifies: number;
  /** Max relay notifies one session received within one 16 ms frame mid-stream. */
  maxStreamingNotifiesPerFrame: number;
  /** live.prompt calls (queued follow-up drained by the settle hook). */
  drainedPrompts: number;
  /** live.tokenUsage calls (occupancy backfill hook). */
  tokenUsageCalls: number;
  /** Final lastAgentText per session index (catalog row / canvas). */
  finalTexts: string[];
  /** Final status per session index from the catalog. */
  finalStatuses: string[];
};

/** Store slice shape the live apply site and sendPromptAction read. */
type ProbeSlice = {
  session: SessionState;
  connectionMode: "live-bridge" | "disconnected" | "connecting";
  bridgeInfo: string;
  lastError: string | null;
  live: Record<string, unknown>;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: never[];
  environment: null;
  promptQueue: PromptQueueItem[];
  restartNotice: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: string | null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: Record<string, "local">;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/**
 * Idle session with one user row (what a resumed chat looks like).
 * @param id Session id.
 */
function seedSession(id: string): SessionState {
  return {
    ...createSessionState({ id, workspace: "/w" }),
    title: id,
    timeline: [
      { id: `u-${id}`, kind: "user", blocks: [{ type: "text", text: "go" }] },
    ],
  };
}

/**
 * Run one streaming scenario and measure store notifications.
 * @param opts Scenario knobs.
 * @returns Counts plus final per-session text / status for parity checks.
 */
export async function runStreamNotifyProbe(
  opts: StreamProbeOpts,
): Promise<StreamProbeResult> {
  const ids = Array.from({ length: opts.sessions }, (_, i) => `${opts.label}-s${i}`);
  const viewed = ids[0] ?? "";
  const turns = opts.turns ?? 1;
  const clock = createFakeFrameClock();
  const counters = { prompts: 0, tokenUsage: 0, store: 0, handler: 0 };
  /** `${frame}:${sessionId}` → relay notifies while streaming. */
  const perFrame = new Map<string, number>();
  forgetAllTurnEdges();

  const store = createStore<ProbeSlice>()(() => ({
    session: seedSession(viewed),
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: {},
    catalog: [],
    activeSessionId: viewed,
    viewingSessionId: viewed,
    poolEntries: [],
    environment: null,
    promptQueue: Array.from({ length: turns }, (_, t) => ({
      id: `q${t}`,
      sessionId: viewed,
      text: `follow-up ${t}`,
    })),
    restartNotice: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: Object.fromEntries(ids.map((id) => [id, "local" as const])),
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
  }));
  const set = store.setState as never;
  const get = store.getState as never;

  /**
   * Mirror of the sessionStoreLive relay handler (minus slash/model caches).
   * @param session Reduced state.
   * @param sessionId Wire id for per-frame accounting.
   * @param meta Recency from onState.
   */
  const paint = (
    session: SessionState,
    sessionId: string,
    meta?: { recency?: "live" | "passive" },
  ): void => {
    counters.handler += 1;
    if (session.status === "streaming") {
      const key = `${clock.frameIndex()}:${sessionId}`;
      perFrame.set(key, (perFrame.get(key) ?? 0) + 1);
    }
    applyLiveInboundSession(set, get, session, meta);
  };

  const dispatch = createLiveBridgeDispatch({
    handlers: {
      onState: (s, meta) => paint(s, s.id, meta),
      onSessionUpdate: (s, meta) => {
        if (meta.applied) {
          paint(s, meta.sessionId);
        }
      },
    },
    clock: {
      setTimeout: (fn, ms) =>
        clock.scheduler.delay(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: (id) => {
        (id as unknown as () => void)();
      },
    },
    coalesce: opts.coalesce
      ? {
          scheduler: clock.scheduler,
          isForeground: (id) => {
            const s = store.getState();
            return shouldFollowSession(s.viewingSessionId, s.activeSessionId, id);
          },
        }
      : undefined,
  });
  store.setState({
    live: {
      prompt: () => {
        counters.prompts += 1;
        return true;
      },
      seedSession: dispatch.seedSession,
      flushPendingUpdates: dispatch.flushPendingUpdates,
      tokenUsage: async () => {
        counters.tokenUsage += 1;
        return { ok: false };
      },
    },
  });

  /** @param msg Wire message for the dispatcher. */
  const send = (msg: BridgeServerMsg): void => {
    dispatch.handleServerMsg(msg);
  };
  for (const id of ids) {
    send({ type: "state", session: seedSession(id) });
  }
  // Measure turn start → settle only (not the connect handshake).
  const unsubscribe = store.subscribe(() => {
    counters.store += 1;
  });
  counters.handler = 0;
  for (let turn = 0; turn < turns; turn++) {
    for (const id of ids) {
      send({ type: "session_lifecycle", sessionId: id, status: "streaming" });
    }
    for (let i = 1; i <= opts.chunksPerSession; i++) {
      for (const id of ids) {
        send({
          type: "session_update",
          sessionId: id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `w${i} ` },
          },
          eventId: `${id}-t${turn}-${i}`,
        });
      }
      clock.advance(opts.chunkIntervalMs);
    }
    for (const id of ids) {
      send({ type: "session_lifecycle", sessionId: id, status: "idle" });
    }
    clock.advance(500);
    // Let the void sendPromptAction / token-usage promises settle.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    });
  }
  unsubscribe();

  const catalog = store.getState().catalog;
  const row = (id: string): SessionRecord | undefined =>
    catalog.find((r) => r.id === id);
  return {
    storeNotifications: counters.store,
    handlerNotifies: counters.handler,
    maxStreamingNotifiesPerFrame: Math.max(0, ...perFrame.values()),
    drainedPrompts: counters.prompts,
    tokenUsageCalls: counters.tokenUsage,
    finalTexts: ids.map((id) => row(id)?.lastAgentText ?? ""),
    finalStatuses: ids.map((id) => row(id)?.status ?? ""),
  };
}
