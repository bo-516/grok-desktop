/**
 * Shared per-frame probe: drives shipped createLiveBridgeDispatch →
 * applyInboundSession over recorded fanout fixtures and records process
 * invariants (rail rows, subagents track, catalog writes).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "@/bridge/liveBridgeDispatch";
import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import { applyInboundSession } from "@/store/sessionStoreLiveInbound";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { SessionRoleIndex } from "@/store/sessionRoles";
import {
  stampProvenance,
  type SessionProvenanceIndex,
} from "@/store/sessionProvenance";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Fixture root for the 2026-08-12 real fanout recording. */
export const FANOUT_FIXTURE_DIR = path.resolve(
  HERE,
  "../fixtures/subagent-fanout-2026-08-12",
);

/** One wire update from fixture JSONL. */
export type WireUpdate = {
  sessionId: string;
  update: Record<string, unknown>;
  eventId?: string;
  ts: number;
};

/** orders.json envelope. */
export type FanoutOrdersMeta = {
  parentSessionId: string;
  workspace: string;
  childSessionIds: string[];
  parentFrameCount: number;
  childFrameCount: number;
  spawnIndex: number;
  orders: Record<
    string,
    { name: string; frames: string[]; seedCatalog?: string }
  >;
};

/**
 * Load orders.json from the fanout fixture tree.
 * @returns Parsed meta including order indexes A/B/C/D.
 */
export function loadFanoutOrders(): FanoutOrdersMeta {
  return JSON.parse(
    readFileSync(path.join(FANOUT_FIXTURE_DIR, "orders.json"), "utf8"),
  ) as FanoutOrdersMeta;
}

/**
 * Parse a fixture JSONL file of WireUpdate rows.
 * @param file Absolute path.
 * @returns Ordered updates.
 */
export function readWireUpdates(file: string): WireUpdate[] {
  const out: WireUpdate[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    out.push(JSON.parse(line) as WireUpdate);
  }
  return out;
}

/**
 * Resolve frame refs (`p:N` / `c:sessionId:N`) into ordered WireUpdates.
 * @param meta Fixture meta.
 * @param frameRefs Order list from orders.json.
 * @returns Ordered wire updates for the probe.
 */
export function resolveOrderFrames(
  meta: FanoutOrdersMeta,
  frameRefs: string[],
): WireUpdate[] {
  const parent = readWireUpdates(
    path.join(FANOUT_FIXTURE_DIR, "parent.jsonl"),
  );
  const children = new Map<string, WireUpdate[]>();
  for (const cid of meta.childSessionIds) {
    children.set(
      cid,
      readWireUpdates(path.join(FANOUT_FIXTURE_DIR, "children", `${cid}.jsonl`)),
    );
  }
  const out: WireUpdate[] = [];
  for (const ref of frameRefs) {
    if (ref.startsWith("p:")) {
      const idx = Number(ref.slice(2));
      const row = parent[idx];
      if (row) {
        out.push(row);
      }
      continue;
    }
    if (ref.startsWith("c:")) {
      const rest = ref.slice(2);
      const colon = rest.lastIndexOf(":");
      const cid = rest.slice(0, colon);
      const idx = Number(rest.slice(colon + 1));
      const row = children.get(cid)?.[idx];
      if (row) {
        out.push(row);
      }
    }
  }
  return out;
}

/** Mutable store slice matching LiveStoreSlice for probes. */
export type ProbeSlice = {
  session: SessionState;
  connectionMode: "live-bridge" | "disconnected" | "connecting";
  bridgeInfo: string;
  lastError: string | null;
  live: null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: never[];
  environment: null;
  promptQueue: Array<{ sessionId: string; text: string }>;
  restartNotice: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: string | null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: SessionProvenanceIndex;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/** Per-frame observation captured by the probe. */
export type FrameObservation = {
  railRows: number;
  subagents: number;
  catalogLen: number;
  pendingLen: number;
  bufferedLen: number;
};

/** Aggregate result of replaying one order. */
export type FanoutProbeResult = {
  peakRailRows: number;
  baselineRailRows: number;
  pollutedFrames: number;
  frameCount: number;
  subagentTrack: number[];
  /**
   * Viewing / main-canvas session id after every frame. Inspect must not
   * change this; a fan-out replay should stay a single value.
   */
  viewingSessionIdTrack: Array<string | null>;
  catalogWrites: number;
  finalRailRows: number;
  finalSubagents: number;
  observations: FrameObservation[];
  slice: ProbeSlice;
};

/**
 * Build a v1 ghost catalog (pre-refactor untagged children + parent without
 * subagents snapshot) for order D / migration tests.
 * @param meta Fixture meta.
 * @returns Stale catalog rows as they appeared before provenance whitelist.
 */
export function buildV1GhostCatalog(meta: FanoutOrdersMeta): SessionRecord[] {
  return [
    {
      id: meta.parentSessionId,
      workspace: meta.workspace,
      title: "fanout parent",
      mode: "build",
      model: "grok-4.5",
      status: "idle",
      createdAt: 1,
      updatedAt: 10,
      timeline: [
        {
          id: "u1",
          kind: "user",
          blocks: [{ type: "text", text: "create 4 subagents" }],
        },
      ],
      toolCalls: {},
      lastAgentText: "",
    },
    ...meta.childSessionIds.map((id, i) => ({
      id,
      workspace: "",
      title: `ghost child ${i}`,
      mode: "build" as const,
      model: "grok-4.5",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 9 - i,
      timeline: [] as SessionRecord["timeline"],
      toolCalls: {},
      lastAgentText: "",
      noProject: true,
    })),
  ];
}

/**
 * Drive shipped dispatch + applyInboundSession over an ordered frame list.
 * Stamps parent as `local` so it is user-facing (simulates forceNew / select).
 *
 * @param frames Ordered wire updates.
 * @param opts Optional seed catalog / provenance / viewing.
 * @returns Peak/polluted metrics and final slice.
 */
export function replayFanOut(
  frames: WireUpdate[],
  opts: {
    meta?: FanoutOrdersMeta;
    seedCatalog?: SessionRecord[];
    sessionProvenance?: SessionProvenanceIndex;
    viewingSessionId?: string | null;
    /** When true, do not stamp parent local (migration-only scenarios). */
    skipParentStamp?: boolean;
  } = {},
): FanoutProbeResult {
  const meta = opts.meta ?? loadFanoutOrders();
  const parentId = meta.parentSessionId;
  const workspace = meta.workspace;

  let provenance: SessionProvenanceIndex = {
    ...(opts.sessionProvenance ?? {}),
  };
  if (!opts.skipParentStamp) {
    provenance = stampProvenance(provenance, parentId, "local");
  }

  // Pre-fanout parent row with real content so the rail baseline is 1 (the
  // user already sees their chat). Empty weak-title seeds would baseline at 0
  // and falsely count the first content paint as pollution.
  const parentSeedRow: SessionRecord = {
    id: parentId,
    workspace,
    title: "fanout parent chat",
    mode: "build",
    model: "grok-4.5",
    status: "idle",
    createdAt: 1,
    updatedAt: 10,
    timeline: [
      {
        id: "seed-user",
        kind: "user",
        blocks: [{ type: "text", text: "create 4 subagents in parallel" }],
      },
    ],
    toolCalls: {},
    lastAgentText: "",
  };
  const seedCatalog =
    opts.seedCatalog ??
    [parentSeedRow];

  let state: ProbeSlice = {
    session: {
      ...createSessionState({ id: parentId, workspace }),
      timeline: parentSeedRow.timeline,
      title: parentSeedRow.title,
    },
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: null,
    catalog: seedCatalog,
    activeSessionId: parentId,
    viewingSessionId:
      opts.viewingSessionId !== undefined ? opts.viewingSessionId : parentId,
    poolEntries: [],
    environment: null,
    promptQueue: [],
    restartNotice: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: provenance,
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
  };

  let catalogWrites = 0;
  let lastCatalogRef: SessionRecord[] | null = state.catalog;
  const get = () => state as never;
  const set = (partial: unknown) => {
    const patch =
      typeof partial === "function"
        ? (partial as (s: unknown) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    if ("catalog" in patch && patch.catalog !== lastCatalogRef) {
      catalogWrites += 1;
      lastCatalogRef = patch.catalog as SessionRecord[];
    }
    state = { ...state, ...patch } as ProbeSlice;
  };

  // localStorage stub for persist paths under Node.
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
    (globalThis as { localStorage: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }

  const dispatch = createLiveBridgeDispatch({
    handlers: {
      onState: (s: SessionState) => applyInboundSession(set, get, s),
      onSessionUpdate: (s: SessionState, metaIn: { applied: boolean }) => {
        if (!metaIn.applied) {
          return;
        }
        applyInboundSession(set, get, s);
      },
    } as never,
  });

  // Seed parent bucket as a live user session (local stamp already applied).
  // Keep the seed timeline so merge does not depend on empty handshake alone.
  dispatch.handleServerMsg({
    type: "state",
    session: {
      id: parentId,
      workspace,
      model: "grok-4.5",
      mode: "build",
      status: "idle",
      timeline: parentSeedRow.timeline,
      toolCalls: {},
      lastAgentText: "",
      title: parentSeedRow.title,
    },
  } as never);

  const baselineRailRows = filterCatalogForSessionRail(state.catalog).length;
  if (baselineRailRows < 1 && !opts.seedCatalog) {
    throw new Error(
      `fanout probe baseline rail expected ≥1, got ${baselineRailRows}`,
    );
  }
  // Count only frame-loop catalog identity changes (seed handshake excluded).
  catalogWrites = 0;
  lastCatalogRef = state.catalog;
  let peakRailRows = baselineRailRows;
  let pollutedFrames = 0;
  const subagentTrack: number[] = [];
  const viewingSessionIdTrack: Array<string | null> = [];
  const observations: FrameObservation[] = [];

  for (const u of frames) {
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: u.sessionId,
      update: u.update,
      eventId: u.eventId,
    } as never);
    const railRows = filterCatalogForSessionRail(state.catalog).length;
    peakRailRows = Math.max(peakRailRows, railRows);
    if (railRows > baselineRailRows) {
      pollutedFrames += 1;
    }
    const subCount = Object.keys(state.session.subagents ?? {}).length;
    subagentTrack.push(subCount);
    viewingSessionIdTrack.push(state.viewingSessionId);
    observations.push({
      railRows,
      subagents: subCount,
      catalogLen: state.catalog.length,
      pendingLen: Object.keys(state.pendingSessions).length,
      bufferedLen: Object.keys(state.childSessions).length,
    });
  }

  return {
    peakRailRows,
    baselineRailRows,
    pollutedFrames,
    frameCount: frames.length,
    subagentTrack,
    viewingSessionIdTrack,
    catalogWrites,
    finalRailRows: filterCatalogForSessionRail(state.catalog).length,
    finalSubagents: Object.keys(state.session.subagents ?? {}).length,
    observations,
    slice: state,
  };
}

/**
 * Whether a numeric series is monotonic non-decreasing.
 * @param track Series of counts (e.g. subagents per frame).
 * @returns True when each value ≥ previous.
 */
export function isMonotonicNonDecreasing(track: number[]): boolean {
  for (let i = 1; i < track.length; i++) {
    if ((track[i] ?? 0) < (track[i - 1] ?? 0)) {
      return false;
    }
  }
  return true;
}
