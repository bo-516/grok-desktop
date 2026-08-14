/**
 * Cold-open disk hydrate: paints chat_history before session/load.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createSessionState,
  userTextFromBlocks,
} from "@grok-desktop/acp-core";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import { hydrateViewingSessionFromDisk } from "@/store/sessionStoreHistory";
import type { SessionStore } from "@/store/sessionStoreTypes";

/** In-memory localStorage so applyInbound persist does not throw. */
function installLocalStorage(): void {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
    configurable: true,
    writable: true,
  });
}

/**
 * Minimal store harness for hydrateViewingSessionFromDisk.
 * @param partial Initial store fields.
 */
function makeHarness(partial: Partial<SessionStore>) {
  let state = {
    session: createSessionState({ id: "s1", workspace: "/work", mode: "build" }),
    connectionMode: "live-bridge" as const,
    bridgeInfo: "",
    lastError: null as string | null,
    live: null as SessionStore["live"],
    catalog: [] as SessionStore["catalog"],
    activeSessionId: "s1" as string | null,
    viewingSessionId: "s1" as string | null,
    viewingSubagent: false,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: {},
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
    poolEntries: [],
    environment: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: "s1" as string | null,
    promptQueue: [],
    restartNotice: null,
    ...partial,
  } as unknown as SessionStore;

  const set = (
    partialOrFn:
      | Partial<SessionStore>
      | ((s: SessionStore) => Partial<SessionStore>),
  ) => {
    const next =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...next };
  };
  const get = () => state;
  return { set, get, getState: () => state };
}

describe("hydrateViewingSessionFromDisk", () => {
  beforeEach(() => {
    installLocalStorage();
    resetCatalogPersistHooksForTests();
  });

  afterEach(() => {
    resetCatalogPersistHooksForTests();
  });

  it("paints chat_history and clears restoring", async () => {
    const h = makeHarness({
      live: {
        cli: async () => ({
          ok: true,
          data: {
            sessionId: "s1",
            cwd: "/work",
            chatHistory: [
              {
                type: "user",
                content: [
                  { type: "text", text: "<user_query>\nhello disk\n</user_query>" },
                ],
              },
              { type: "assistant", content: "from disk" },
            ],
            updates: [],
          },
        }),
        seedSession: () => undefined,
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
      cwd: "/work",
    });
    assert.equal(ok, true);
    const session = h.getState().session;
    assert.equal(session.id, "s1");
    const users = session.timeline.filter((item) => item.kind === "user");
    assert.equal(users.length, 1);
    assert.equal(userTextFromBlocks(users[0]!.blocks), "hello disk");
    assert.equal(h.getState().restoringSessionId, null);
  });

  it("no-ops when the user already switched away", async () => {
    let cliCalls = 0;
    const h = makeHarness({
      viewingSessionId: "other",
      live: {
        cli: async () => {
          cliCalls += 1;
          return { ok: true, data: { chatHistory: [], updates: [] } };
        },
        seedSession: () => undefined,
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
      cwd: "/work",
    });
    assert.equal(ok, false);
    assert.equal(cliCalls, 0);
    assert.equal(h.getState().session.timeline.length, 0);
    assert.equal(h.getState().restoringSessionId, "s1");
  });

  it("skips fetch when the canvas already has conversation content", async () => {
    let cliCalls = 0;
    const seeded = createSessionState({
      id: "s1",
      workspace: "/work",
      mode: "build",
    });
    seeded.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "cached" }],
        origin: "seed",
      },
    ];
    const h = makeHarness({
      session: seeded,
      restoringSessionId: "s1",
      live: {
        cli: async () => {
          cliCalls += 1;
          return { ok: true, data: {} };
        },
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
    });
    assert.equal(ok, true);
    assert.equal(cliCalls, 0);
    assert.equal(h.getState().restoringSessionId, null);
  });
});
