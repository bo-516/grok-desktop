/**
 * Store slice + set/get signatures shared by the live inbound / start /
 * sync modules. Type-only, so the inbound step modules can depend on it
 * without importing sessionStoreLiveInbound (which re-exports these names).
 */

import type { AgentMode, SessionState } from "@grok-desktop/acp-core";
import type { PromptQueueItem } from "@/lib/promptQueue";
import type { EnvironmentInfo, PoolEntry } from "../bridge/liveBridgeTypes";
import type { SessionRecord } from "./sessionCatalogTypes";
import type { SessionProvenanceIndex } from "./sessionProvenance";
import type { SessionRoleIndex } from "./sessionRoles";
import type { HeldPrompt } from "./sessionStoreModeHoldCanvas";
import type { ConnectionMode, LiveHandle } from "./sessionStoreLiveTypes";

/** Minimal store slice for inbound apply + startLiveBridge. */
export type LiveStoreSlice = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /** Open subagent flag. Disk refresh clears this when that id is gone. */
  viewingSubagent?: boolean;
  /** Parent of the open subagent. Cleared with viewingSubagent on that refresh. */
  viewingParentSessionId?: string;
  /** Resident process summaries in the pool (rail status lights). */
  poolEntries: PoolEntry[];
  /** CLI / login probe; null means not received yet. */
  environment: EnvironmentInfo | null;
  /**
   * Login flag written by both the environment probe and the 3s `auth_state`
   * poll; null until one of them answers. Optional so older call sites that
   * build a slice literal still type-check.
   */
  authed?: boolean | null;
  /** Queued user prompts while streaming (session-scoped items). */
  promptQueue: PromptQueueItem[];
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
   * In-flight mode switch target. Inbound frames must not paint over it.
   * Optional so older call sites still type-check.
   */
  pendingMode?: AgentMode | null;
  /** Prompt painted locally while session/set_mode is still running. */
  heldPrompt?: HeldPrompt | null;
  /**
   * Uncached session waiting for session/load replay to land.
   * Optional so older call sites still type-check.
   */
  restoringSessionId?: string | null;
  /**
   * childSessionId → { parentSessionId, sessionKind }.
   * Live first-hand from subagent cards; also rebuilt from catalog on hydrate.
   */
  sessionRoles?: SessionRoleIndex;
  /**
   * In-memory reduce buffers for known child sessions (not persisted).
   * Streaming updates land here so the rail catalog stays still.
   */
  childSessions?: Record<string, SessionState>;
  /**
   * sessionId → provenance (local/resumed/disk/child/wire).
   * Wire is default; only user-facing provenances enter the catalog.
   */
  sessionProvenance?: SessionProvenanceIndex;
  /**
   * Unproven wire-only session buffers (not persisted). Claimed by spawn,
   * sessions_list, or disconnect/hide flush.
   */
  pendingSessions?: Record<string, SessionState>;
  /** Oldest-first order of pendingSessions keys (for bounded eviction). */
  pendingSessionOrder?: string[];
  /**
   * Monotonic counter bumped only when catalog row identity set changes in a
   * way that affects openable-child Sets (Agents rail deps).
   */
  catalogRevision?: number;
};

/**
 * Zustand-style setter over LiveStoreSlice: a partial patch or an updater
 * of the current slice. Keys left out of the patch are untouched.
 */
export type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;

/** Zustand-style getter; returns the latest slice (re-read after every set). */
export type GetState = () => LiveStoreSlice;
