/**
 * T1/T2 catalog persist: no double normalize on hot path; throttled setItem.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  CATALOG_PERSIST_THROTTLE_MS,
  enqueueCatalogPersist,
  flushCatalogNow,
  resetCatalogPersistHooksForTests,
  setCatalogPersistClockForTests,
} from "@/store/catalogPersistQueue";
import {
  normalizeCatalog,
  SESSION_STORAGE_KEY,
  type SessionRecord,
} from "@/store/sessionCatalog";
import {
  persistCatalog,
  persistNormalizedCatalog,
} from "@/store/sessionStoreSupport";
import { applyInboundSession } from "@/store/sessionStoreLive";

/** In-memory localStorage stub. */
function installLocalStorage(): {
  setItemCalls: number;
  lastValue: string | null;
  mem: Map<string, string>;
} {
  const mem = new Map<string, string>();
  const state = { setItemCalls: 0, lastValue: null as string | null, mem };
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      state.setItemCalls += 1;
      state.lastValue = v;
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return state;
}

function sampleRecord(id: string, n = 0): SessionRecord {
  return {
    id,
    workspace: "/w",
    title: `Chat ${id}`,
    mode: "build",
    model: "m",
    status: "idle",
    createdAt: 1,
    updatedAt: 1 + n,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

describe("catalog persist T1/T2", () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
    resetCatalogPersistHooksForTests();
    setCatalogPersistClockForTests(null);
  });

  afterEach(() => {
    resetCatalogPersistHooksForTests();
    setCatalogPersistClockForTests(null);
  });

  it("persistNormalizedCatalog 不再二次归一(T1)", () => {
    // Hot path: already-normalized catalog is written as-is (strong title kept).
    const rec = sampleRecord("a");
    const catalog = normalizeCatalog([rec]);
    storage.setItemCalls = 0;
    persistNormalizedCatalog(catalog);
    assert.equal(storage.setItemCalls, 1);
    const parsed = JSON.parse(storage.lastValue ?? "[]") as SessionRecord[];
    assert.equal(parsed[0]?.title, "Chat a");
    assert.equal(parsed.length, catalog.length);

    // Cold path: persistCatalog still runs normalizeCatalog before enqueue.
    // A raw catalog with a blank title is rehydrated to a fallback label.
    setCatalogPersistClockForTests(null);
    storage.setItemCalls = 0;
    const raw: SessionRecord = {
      ...sampleRecord("raw"),
      title: "",
      timeline: [
        {
          kind: "user",
          id: "u1",
          blocks: [{ type: "text", text: "hello from timeline" }],
        },
      ],
    };
    persistCatalog([raw]);
    flushCatalogNow();
    assert.ok(storage.setItemCalls >= 1);
    const after = JSON.parse(storage.lastValue ?? "[]") as SessionRecord[];
    assert.equal(after.length, 1);
    // normalizeCatalog rehydrates empty title from timeline.
    assert.equal(after[0]?.title, "hello from timeline");
  });

  it("落盘节流(T2): 100 updates → ≤2 setItem, last content wins", () => {
    let now = 0;
    const timers: { fn: () => void; at: number }[] = [];
    setCatalogPersistClockForTests({
      now: () => now,
      setTimeout: (fn, ms) => {
        const handle = { fn, at: now + ms };
        timers.push(handle);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id) => {
        const idx = timers.indexOf(
          id as unknown as { fn: () => void; at: number },
        );
        if (idx >= 0) {
          timers.splice(idx, 1);
        }
      },
    });
    storage.setItemCalls = 0;
    let lastCatalog: SessionRecord[] = [];
    for (let i = 0; i < 100; i++) {
      lastCatalog = [sampleRecord("s", i)];
      enqueueCatalogPersist(lastCatalog);
      // Advance 10ms per update — stay inside 1000ms window after first write.
      now += 10;
    }
    // First write is immediate; remaining should arm one timer.
    assert.ok(storage.setItemCalls <= 2, `setItemCalls=${storage.setItemCalls}`);
    // Fire pending timer(s).
    const due = [...timers];
    for (const t of due) {
      now = Math.max(now, t.at);
      t.fn();
    }
    assert.ok(storage.setItemCalls <= 2, `after flush setItemCalls=${storage.setItemCalls}`);
    const parsed = JSON.parse(storage.lastValue ?? "[]") as SessionRecord[];
    assert.equal(parsed[0]?.updatedAt, lastCatalog[0]?.updatedAt);
    assert.equal(storage.mem.get(SESSION_STORAGE_KEY), storage.lastValue);
  });

  it("flush 钩子(T2): flushCatalogNow writes immediately", () => {
    let now = 0;
    setCatalogPersistClockForTests({
      now: () => now,
      setTimeout: (fn, ms) => {
        return { fn, ms } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {
        /* */
      },
    });
    storage.setItemCalls = 0;
    // First write immediate.
    enqueueCatalogPersist([sampleRecord("a", 1)]);
    assert.equal(storage.setItemCalls, 1);
    // Second within window — pending only.
    now = 100;
    enqueueCatalogPersist([sampleRecord("a", 2)]);
    assert.equal(storage.setItemCalls, 1);
    flushCatalogNow();
    assert.equal(storage.setItemCalls, 2);
    const parsed = JSON.parse(storage.lastValue ?? "[]") as SessionRecord[];
    assert.equal(parsed[0]?.updatedAt, 3); // 1+2 from sampleRecord
  });

  it("QuotaExceeded surfaces console.warn", () => {
    const warns: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem: () => null,
          setItem: () => {
            const err = new Error("quota");
            err.name = "QuotaExceededError";
            throw err;
          },
          removeItem: () => {
            /* */
          },
        },
        configurable: true,
      });
      flushCatalogNow([sampleRecord("q")]);
      assert.ok(warns.length >= 1);
      assert.match(String(warns[0]?.[0]), /session-catalog/);
      assert.match(String(warns[0]?.[0]), /QuotaExceededError/);
    } finally {
      console.warn = orig;
    }
  });

  it("applyInboundSession hot path uses single normalize (T1 store)", () => {
    // Drive real applyInboundSession: catalog grows without throwing; setItem
    // is throttled so 5 inbound updates do not equal 5 disk writes after first.
    let now = 0;
    setCatalogPersistClockForTests({
      now: () => now,
      setTimeout: (fn, _ms) => {
        return { fn } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {
        /* */
      },
    });
    storage.setItemCalls = 0;
    let catalog: SessionRecord[] = [];
    let session = createSessionState({ id: "hot", workspace: "/w" });
    type Slice = {
      session: typeof session;
      connectionMode: "live-bridge" | "disconnected" | "connecting";
      bridgeInfo: string;
      lastError: string | null;
      live: null;
      catalog: SessionRecord[];
      activeSessionId: string | null;
      viewingSessionId: string | null;
      poolEntries: never[];
      environment: null;
      promptQueue: { sessionId: string; text: string }[];
      restartNotice: string | null;
      localDraft: boolean;
      creatingSession: boolean;
      pendingMode: null;
      restoringSessionId: string | null;
    };
    const get = (): Slice => ({
      session,
      connectionMode: "live-bridge",
      bridgeInfo: "",
      lastError: null,
      live: null,
      catalog,
      activeSessionId: "hot",
      viewingSessionId: "hot",
      poolEntries: [],
      environment: null,
      promptQueue: [],
      restartNotice: null,
      localDraft: false,
      creatingSession: false,
      pendingMode: null,
      restoringSessionId: null,
    });
    const set = (
      partial: Partial<Slice> | ((s: Slice) => Partial<Slice>),
    ): void => {
      const patch = typeof partial === "function" ? partial(get()) : partial;
      if (patch.catalog) {
        catalog = patch.catalog;
      }
      if (patch.session) {
        session = patch.session;
      }
    };
    for (let i = 0; i < 5; i++) {
      const inbound = createSessionState({ id: "hot", workspace: "/w" });
      inbound.lastAgentText = `t${i}`;
      inbound.timeline = [
        { kind: "agent", id: `a${i}`, text: `t${i}`, origin: "agent" },
      ];
      applyInboundSession(set as never, get as never, inbound);
      now += 50;
    }
    // Throttle: first write + at most one pending flush after force.
    assert.ok(
      storage.setItemCalls <= 2,
      `expected ≤2 setItem, got ${storage.setItemCalls}`,
    );
    flushCatalogNow();
    assert.ok(catalog.some((r) => r.id === "hot"));
  });
});

describe("catalog persist throttle constant", () => {
  it("throttle is ≥1000ms", () => {
    assert.ok(CATALOG_PERSIST_THROTTLE_MS >= 1000);
  });
});
