/**
 * Session store actions: prompt queue, send, cancel, permission reply.
 * Wired into useSessionStore; no React.
 * New chat drafts create the real bridge session only on first send.
 * User bubbles are painted optimistically before create/connect waits so the
 * timeline never stays blank while forceNew runs.
 */

import type {
  SessionStoreGet,
  SessionStoreSet,
} from "./sessionStoreTypes";
import {
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
} from "./sessionStoreLive";
import { recordToSessionState } from "./sessionCatalog";
import {
  appendUserPrompt,
  type ContentBlock,
  type TimelineItem,
} from "@grok-desktop/acp-core";

/** Poll interval while waiting for forceNew canvas id (ms). */
const WAIT_SESSION_ID_POLL_MS = 40;
/** Max wait for handshake to paint session.id after forceNew (ms). */
const WAIT_SESSION_ID_TIMEOUT_MS = 45_000;

/**
 * Wait until the main canvas has a real session id (forceNew handshake).
 * Only watches `session.id` so a background pool resident's activeSessionId
 * cannot satisfy the wait and steal the prompt target.
 * @param get Zustand get.
 * @param timeoutMs Hard deadline; returns null when exceeded.
 * @returns Canvas session id, or null on timeout.
 */
export async function waitForCanvasSessionId(
  get: SessionStoreGet,
  timeoutMs: number = WAIT_SESSION_ID_TIMEOUT_MS,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = get().session.id.trim();
    if (id) {
      return id;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, WAIT_SESSION_ID_POLL_MS);
    });
  }
  return null;
}

/**
 * Enqueue a non-empty prompt while a turn is in flight.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param text Raw user text; trimmed; empty is ignored.
 */
export function enqueuePromptAction(
  set: SessionStoreSet,
  _get: SessionStoreGet,
  text: string,
): void {
  const t = text.trim();
  if (!t) {
    return;
  }
  set((s) => ({ promptQueue: [...s.promptQueue, t] }));
}

/**
 * Pop the head of the prompt queue, or null when empty.
 * @param set Zustand set.
 * @param get Zustand get.
 * @returns Dequeued text or null.
 */
export function dequeuePromptAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): string | null {
  const q = get().promptQueue;
  if (q.length === 0) {
    return null;
  }
  const [head, ...rest] = q;
  set({ promptQueue: rest });
  return head ?? null;
}

/**
 * True when a timeline row is an unconfirmed optimistic local user bubble.
 * @param item Timeline entry.
 * @returns Whether rollback may remove this row after a failed send.
 */
function isOptimisticLocalUser(item: TimelineItem): boolean {
  return (
    item.kind === "user" &&
    !item.agentConfirmed &&
    (item.origin === "local" || Boolean(item.clientPromptId))
  );
}

/**
 * Remove the newest unconfirmed local user row after a hard send failure.
 * Restores idle status so the composer send button returns; leaves any earlier
 * confirmed history intact.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function rollbackOptimisticLocalUser(
  set: SessionStoreSet,
  get: SessionStoreGet,
): void {
  const session = get().session;
  let idx = -1;
  for (let i = session.timeline.length - 1; i >= 0; i -= 1) {
    const item = session.timeline[i];
    if (item && isOptimisticLocalUser(item)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return;
  }
  const timeline = [
    ...session.timeline.slice(0, idx),
    ...session.timeline.slice(idx + 1),
  ];
  set({
    session: {
      ...session,
      timeline,
      status: "idle",
    },
  });
}

/**
 * Paint the user prompt on the canvas before any connect / forceNew wait.
 * Uses the same appendUserPrompt path as the ACP client so later agent
 * user_message_chunk events absorb into this row instead of duplicating it.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param text Trimmed user text (may be empty for image-only sends).
 * @param blocks Optional multi-block content; when omitted a single text block is used.
 */
function paintOptimisticUserPrompt(
  set: SessionStoreSet,
  get: SessionStoreGet,
  text: string,
  blocks?: ContentBlock[],
): void {
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  const promptBlocks: ContentBlock[] = hasBlocks
    ? blocks!
    : [{ type: "text", text }];
  if (
    promptBlocks.length === 0 ||
    (promptBlocks.length === 1 &&
      promptBlocks[0]?.type === "text" &&
      !promptBlocks[0].text.trim())
  ) {
    return;
  }
  set({ session: appendUserPrompt(get().session, promptBlocks) });
}

/**
 * Ensure a live canvas session exists: forceNew when on a New chat draft
 * (empty session.id). If a forceNew is already in flight, only waits for id.
 * @param set Zustand set.
 * @param get Zustand get.
 * @returns Session id ready for prompt, or null on hard failure.
 */
async function ensureSessionForSend(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<string | null> {
  const existing = get().session.id.trim();
  if (existing) {
    return existing;
  }

  // Prefer viewing over active: active may still name a background pool process
  // while the canvas is an empty New chat draft.
  const resumeHint = get().viewingSessionId?.trim() || "";
  if (resumeHint) {
    return resumeHint;
  }

  // Outer reconnect path may have already kicked forceNew + creatingSession.
  const alreadyCreating = get().creatingSession;
  if (!alreadyCreating) {
    set({
      creatingSession: true,
      lastError: null,
      bridgeInfo: "Creating new session…",
    });
    try {
      const workspace = get().session.workspace.trim();
      await startLiveBridgeSession(set, get, {
        alwaysApprove: DEFAULT_ALWAYS_APPROVE,
        cwd: workspace || undefined,
        forceNew: true,
      });
    } catch {
      set({
        creatingSession: false,
        bridgeInfo: "Cannot connect to bridge. Run npm run bridge first",
      });
      return null;
    }
  }

  const sid = await waitForCanvasSessionId(get);
  if (!sid) {
    set({
      creatingSession: false,
      bridgeInfo: "Session not ready yet — try send again",
    });
    return null;
  }
  set({ creatingSession: false, localDraft: false });
  return sid;
}

/**
 * Send prompt text and optional multi-block content (images / resource_link).
 * Queues text while streaming; auto-connects bridge when disconnected.
 * On a New chat draft (no session id), creates the real session first — but the
 * user bubble is painted immediately so create latency is not a blank wait.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param draft User text (also used for queue key).
 * @param blocks Optional ACP ContentBlocks; when set, bridge sends full prompt array.
 * @returns True when accepted (sent or queued); false on hard failure (optimistic
 *   bubble rolled back).
 */
export async function sendPromptAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  draft: string,
  blocks?: ContentBlock[],
): Promise<boolean> {
  const { connectionMode, live, session, viewingSessionId, lastError } = get();
  const text = draft.trim();
  // Allow image-only sends (blocks with image, empty text).
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  if (!text && !hasBlocks) {
    return false;
  }

  // Queue while turn is in flight (F-STREAM-09) — never drop user text.
  // Queued items are text-only; multi-block must wait for idle (J-06 honesty).
  // Draft canvas has status idle even if another pool session is streaming.
  // Optimistic status is "streaming" after a local paint; only queue when the
  // canvas already has a real session id (otherwise first-send create path).
  if (
    connectionMode === "live-bridge" &&
    live &&
    session.id &&
    (session.status === "streaming" || session.status === "waiting_permission")
  ) {
    if (hasBlocks && !text) {
      set({
        bridgeInfo:
          "Attachments wait until the current turn finishes — try again when idle",
      });
      return false;
    }
    enqueuePromptAction(set, get, text || "(attachment pending)");
    set({
      bridgeInfo: `Queued (${get().promptQueue.length}) — will send after turn`,
    });
    return true;
  }

  // Show the user message before any connect / forceNew await (snappy UX).
  paintOptimisticUserPrompt(set, get, text, hasBlocks ? blocks : undefined);
  let painted = true;

  if (connectionMode !== "live-bridge" || !live) {
    // New chat draft: never resume catalog[0] — always forceNew on first send.
    const onDraft = get().localDraft || (!session.id.trim() && !viewingSessionId);
    const id = onDraft
      ? ""
      : viewingSessionId || session.id || get().catalog[0]?.id;
    try {
      if (id) {
        const rec = get().catalog.find((s) => s.id === id);
        await startLiveBridgeSession(set, get, {
          alwaysApprove: DEFAULT_ALWAYS_APPROVE,
          cwd: rec?.workspace || session.workspace || undefined,
          resumeId: id,
          seed: rec ? recordToSessionState(rec) : session,
        });
      } else {
        // Draft or empty catalog — open WS + forceNew once; ensure only waits.
        set({
          creatingSession: true,
          lastError: null,
          bridgeInfo: "Creating new session…",
        });
        await startLiveBridgeSession(set, get, {
          alwaysApprove: DEFAULT_ALWAYS_APPROVE,
          cwd: session.workspace.trim() || undefined,
          forceNew: true,
        });
      }
    } catch {
      if (painted) {
        rollbackOptimisticLocalUser(set, get);
      }
      set({
        creatingSession: false,
        bridgeInfo: "Cannot connect to bridge. Run npm run bridge first",
      });
      return false;
    }
  }

  const handle = get().live;
  if (!handle) {
    if (painted) {
      rollbackOptimisticLocalUser(set, get);
    }
    return false;
  }

  const err = get().lastError;
  if (err) {
    if (painted) {
      rollbackOptimisticLocalUser(set, get);
    }
    set({
      bridgeInfo: `Cannot send: ${err}. Try "New chat" or "Reconnect"`,
    });
    return false;
  }

  const sid = await ensureSessionForSend(set, get);
  if (!sid) {
    if (painted) {
      rollbackOptimisticLocalUser(set, get);
    }
    return false;
  }

  // Slash commands route as prompt text; multi-block path carries images (F-STREAM-07).
  const ok = handle.prompt(text, sid, hasBlocks ? blocks : undefined);
  if (!ok) {
    if (painted) {
      rollbackOptimisticLocalUser(set, get);
    }
    set({
      bridgeInfo: "Send failed: bridge not connected. Run npm run bridge",
      lastError: lastError ?? "bridge not connected",
    });
    return false;
  }
  return true;
}

/**
 * Cancel the in-flight turn on the live bridge when connected.
 * @param get Zustand get.
 */
export function cancelTurnAction(get: SessionStoreGet): void {
  const { connectionMode, live, session, viewingSessionId, activeSessionId } =
    get();
  if (connectionMode === "live-bridge" && live) {
    live.cancel(session.id || viewingSessionId || activeSessionId || undefined);
  }
}

/**
 * Reply to a pending permission request on the live bridge.
 * @param get Zustand get.
 * @param optionId Permission option id from the agent request.
 */
export function respondPermissionAction(
  get: SessionStoreGet,
  optionId: string,
): void {
  const { connectionMode, live, session, viewingSessionId, activeSessionId } =
    get();
  if (connectionMode === "live-bridge" && live) {
    live.permission(
      optionId,
      session.id || viewingSessionId || activeSessionId || undefined,
    );
  }
}
