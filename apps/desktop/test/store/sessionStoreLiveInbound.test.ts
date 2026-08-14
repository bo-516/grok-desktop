/**
 * Restore vs live settle: disk hydrate / first idle must not drain the
 * prompt queue. A real busy→idle on the followed canvas drains through
 * sendPromptAction (the same hook onState / onSessionUpdate use).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import { applyInboundSession } from "@/store/sessionStoreLiveInbound";
import { applyLiveInboundSession } from "@/store/sessionStoreLive";
import { forgetAllTurnEdges, forgetTurnEdge } from "@/store/sessionTurnEdge";
import type { PromptQueueItem } from "@/lib/promptQueue";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { SessionRoleIndex } from "@/store/sessionRoles";

const A = "sess-a";
const B = "sess-b";

/** One live.prompt invocation recorded by the store double. */
type PromptCall = unknown[];

/** Minimal mutable store slice for inbound + sendPromptAction. */
type Slice = {
  session: SessionState;
  connectionMode: "live-bridge" | "disconnected" | "connecting";
  bridgeInfo: string;
  lastError: string | null;
  live: {
    prompt: (...args: unknown[]) => boolean;
    seedSession?: (s: SessionState) => void;
  };
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: Array<{ sessionId: string; status: string }>;
  environment: null;
  promptQueue: PromptQueueItem[];
  restartNotice: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: string | null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: Record<
    string,
    "local" | "resumed" | "disk" | "child" | "wire"
  >;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/**
 * Build an inbound SessionState with a short conversation so restoreDone
 * can fire when restoringSessionId matches.
 * @param id Session id.
 * @param status Live status for this frame.
 */
function frame(
  id: string,
  status: SessionState["status"],
): SessionState {
  const session = createSessionState({ id, workspace: "/w" });
  session.status = status;
  session.title = id;
  session.timeline = [
    {
      id: `u-${id}`,
      kind: "user",
      blocks: [{ type: "text", text: "hello" }],
    },
  ];
  return session;
}

/**
 * Zustand-shaped get/set plus a live.prompt spy.
 * @param opts Canvas id, queue, restore flag, extra provenance.
 */
function makeStore(opts: {
  canvasId?: string;
  queue?: PromptQueueItem[];
  restoringSessionId?: string | null;
  provenance?: Slice["sessionProvenance"];
}): {
  get: () => Slice;
  set: (partial: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => void;
  snap: () => Slice;
  prompts: PromptCall[];
} {
  const canvasId = opts.canvasId ?? A;
  const prompts: PromptCall[] = [];
  let state: Slice = {
    session: frame(canvasId, "idle"),
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: {
      prompt: (...args: unknown[]) => {
        prompts.push(args);
        return true;
      },
      seedSession: () => undefined,
    },
    catalog: [],
    activeSessionId: canvasId,
    viewingSessionId: canvasId,
    poolEntries: [],
    environment: null,
    promptQueue: opts.queue ?? [],
    restartNotice: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: opts.restoringSessionId ?? null,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: opts.provenance ?? { [A]: "local", [B]: "local" },
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
  };
  return {
    get: () => state,
    set: (partial) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    },
    snap: () => state,
    prompts,
  };
}

/**
 * One queued follow-up bound to a session.
 * @param sessionId Owning session.
 * @param text Prompt text.
 */
function queued(sessionId: string, text: string): PromptQueueItem {
  return { id: `q-${sessionId}`, sessionId, text };
}

/**
 * Flush the void sendPromptAction started by the live settle hook.
 */
async function flushSend(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
}

afterEach(() => {
  resetCatalogPersistHooksForTests();
  forgetAllTurnEdges();
});

describe("applyInboundSession / applyLiveInboundSession queue drain", () => {
  it("passive disk hydrate leaves the queue and never calls live.prompt", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    const outcome = applyInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
      { recency: "passive" },
    );
    await flushSend();
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("first idle frame (replay_end / no prior status) does not drain", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("replay_end-shaped live onState (recency passive) does not drain", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
      { recency: "passive" },
    );
    await flushSend();
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("streaming then idle on the followed canvas drains via sendPromptAction", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    assert.equal(store.snap().promptQueue.length, 1);
    const settled = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(settled.turnSettled, true);
    assert.equal(store.snap().promptQueue.length, 0);
    assert.equal(store.prompts.length, 1);
    // sendPromptAction calls prompt(text, sid, blocks?) — not drain's 2-arg form.
    assert.equal(store.prompts[0]?.length, 3);
    assert.equal(store.prompts[0]?.[0], "later");
    assert.equal(store.prompts[0]?.[1], A);
    const userRows = store
      .snap()
      .session.timeline.filter((item) => item.kind === "user");
    assert.ok(
      userRows.some((item) =>
        item.blocks.some(
          (block) => block.type === "text" && block.text.includes("later"),
        ),
      ),
      "sendPromptAction must paint the optimistic user bubble",
    );
  });

  it("waiting_permission then idle on the followed canvas drains via sendPromptAction", async () => {
    const store = makeStore({ queue: [queued(A, "after-perm")] });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "waiting_permission"),
    );
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(store.snap().promptQueue.length, 0);
    assert.equal(store.prompts[0]?.[0], "after-perm");
    assert.equal(store.prompts[0]?.length, 3);
  });

  it("queue bound to session B stays when session A settles", async () => {
    const store = makeStore({
      canvasId: A,
      queue: [queued(B, "for-b")],
    });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.snap().promptQueue[0]?.sessionId, B);
    assert.equal(store.prompts.length, 0);
  });

  it("background resident idle (follow false) does not drain", async () => {
    const store = makeStore({
      canvasId: A,
      queue: [queued(B, "bg")],
    });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(B, "streaming"),
    );
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(B, "idle"),
    );
    await flushSend();
    assert.equal(outcome.follow, false);
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
    assert.equal(store.snap().session.id, A);
  });

  it("inbound apply alone never drains even on a real busy→idle edge", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    applyInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    applyInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("idle after forget (delete / disconnect) is not a settle", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    forgetAllTurnEdges();
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("idle after forgetTurnEdge (session delete) is not a settle", async () => {
    const store = makeStore({ queue: [queued(A, "later")] });
    applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "streaming"),
    );
    forgetTurnEdge(A);
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });

  it("delete / disconnect / onClose source calls the shipped forget helpers", () => {
    const srcDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../src/store",
    );
    const nav = readFileSync(join(srcDir, "sessionStoreNavigation.ts"), "utf8");
    const live = readFileSync(join(srcDir, "sessionStoreLive.ts"), "utf8");
    assert.match(nav, /forgetTurnEdge\(id\)/);
    assert.match(nav, /forgetAllTurnEdges\(\)/);
    assert.match(live, /forgetAllTurnEdges\(\)/);
    assert.match(live, /applyLiveInboundSession\(set, get, session, meta\)/);
    assert.match(live, /applyLiveInboundSession\(set, get, session\)/);
  });

  it("restoringSessionId idle landing frame is not a settle", async () => {
    const store = makeStore({
      queue: [queued(A, "later")],
      restoringSessionId: A,
    });
    const outcome = applyLiveInboundSession(
      store.set as never,
      store.get as never,
      frame(A, "idle"),
    );
    await flushSend();
    assert.equal(outcome.restoreDone, true);
    assert.equal(outcome.turnSettled, false);
    assert.equal(store.snap().promptQueue.length, 1);
    assert.equal(store.prompts.length, 0);
  });
});
