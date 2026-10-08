/**
 * Catalog stamping and the localStorage maps for worktree chats.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  loadWorktreeChatDefault,
  loadWorktreeSourceCache,
  overlayWorktreeSources,
  saveWorktreeChatDefault,
  saveWorktreeSourceCache,
  sourceCacheFromProbe,
  sourceCacheHas,
  stampCatalogWorktrees,
} from "@/lib/worktreeChatCatalog";
import type { SessionRecord } from "@/store/sessionCatalog";

/** Defaults map key. Corrupt values must not turn the checkbox on. */
const DEFAULTS_KEY = "grok-desktop.worktree-chat-defaults.v1";
/** Source-repo map key. */
const SOURCE_CACHE_KEY = "grok-desktop.worktree-source.v1";

/**
 * Minimal catalog row. Extra fields override the idle defaults.
 * @param partial Id, workspace, and any badge the case cares about.
 * @returns A row the stamp and overlay helpers accept.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id" | "workspace">,
): SessionRecord {
  return {
    title: partial.id,
    mode: "build",
    model: "m",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
    ...partial,
  };
}

/** In-memory store backing a fake localStorage for this suite. */
const store = new Map<string, string>();
/** Storage stub. Missing keys return null, matching the browser. */
const fakeStorage: Storage = {
  get length() {
    return store.size;
  },
  clear() {
    store.clear();
  },
  getItem(key: string) {
    return store.has(key) ? (store.get(key) as string) : null;
  },
  key(index: number) {
    return [...store.keys()][index] ?? null;
  },
  removeItem(key: string) {
    store.delete(key);
  },
  setItem(key: string, value: string) {
    store.set(key, String(value));
  },
};

describe("worktree chat catalog", { concurrency: 1 }, () => {
  /** Previous global localStorage descriptor, restored after each test. */
  let previous: PropertyDescriptor | undefined;

  beforeEach(() => {
    store.clear();
    previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      enumerable: true,
      value: fakeStorage,
      writable: true,
    });
  });

  afterEach(() => {
    if (previous) {
      Object.defineProperty(globalThis, "localStorage", previous);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("stamps a pool identity and ignores a frame that has none", () => {
    const plain = rec({ id: "plain", workspace: "/proj/demo" });
    const badged = rec({
      id: "badged",
      workspace: "/tmp/wt",
      worktree: {
        path: "/tmp/wt",
        branch: "old",
        sourceRepo: "/proj/demo",
      },
    });
    /** Rows a partial pool frame must not clone or unbadge. */
    const catalog = [plain, badged];
    const untouched = stampCatalogWorktrees(catalog, [
      { sessionId: "plain" },
      { sessionId: "badged", worktree: { path: " ", branch: "", sourceRepo: "" } },
    ]);
    assert.equal(untouched, catalog);
    assert.equal(untouched[1], badged);

    const stamped = stampCatalogWorktrees([plain, badged], [
      {
        sessionId: "plain",
        worktree: {
          path: "/tmp/wt-new",
          branch: "feat",
          sourceRepo: "/proj/demo",
          name: " task ",
          id: " wt-9 ",
        },
      },
    ]);
    assert.equal(stamped[1], badged);
    assert.deepEqual(stamped[0]?.worktree, {
      path: "/tmp/wt-new",
      branch: "feat",
      sourceRepo: "/proj/demo",
      name: "task",
      id: "wt-9",
    });
    const cached = loadWorktreeSourceCache();
    assert.equal(cached["/private/tmp/wt-new"]?.sourceRepo, "/proj/demo");
  });

  it("keeps the same row reference when the badge is unchanged", () => {
    const info = {
      path: "/tmp/wt",
      branch: "feat",
      sourceRepo: "/proj/demo",
      name: "task",
      id: "wt-1",
    };
    const row = rec({ id: "s", workspace: "/tmp/wt", worktree: info });
    const next = stampCatalogWorktrees(
      [row],
      [{ sessionId: "s", worktree: info }],
    );
    assert.equal(next[0], row);
  });

  it("overlays a cached source and skips a negative or same-path hit", () => {
    const row = rec({ id: "s", workspace: "/tmp/wt" });
    const negative = overlayWorktreeSources([row], {
      "/private/tmp/wt": { sourceRepo: null },
    });
    assert.equal(negative[0], row);
    const same = overlayWorktreeSources([row], {
      "/private/tmp/wt": { sourceRepo: "/tmp/wt" },
    });
    assert.equal(same[0], row);
    const overlaid = overlayWorktreeSources([row], {
      "/private/tmp/wt": {
        sourceRepo: "/proj/demo",
        branch: "feat",
        name: "task",
        id: "wt-1",
        path: "/tmp/wt",
      },
    });
    assert.equal(overlaid[0]?.worktree?.sourceRepo, "/proj/demo");
    assert.equal(overlaid[0]?.worktree?.branch, "feat");
    assert.equal(
      sourceCacheHas(
        { "/private/tmp/wt": { sourceRepo: null } },
        "/tmp/wt",
      ),
      true,
    );
    assert.equal(sourceCacheHas({}, "/tmp/wt"), false);
  });

  it("turns a probe into a positive or negative cache entry", () => {
    assert.deepEqual(sourceCacheFromProbe("/tmp/wt", { ok: false }), {
      sourceRepo: null,
    });
    assert.deepEqual(
      sourceCacheFromProbe("/proj/demo", {
        ok: true,
        data: { isRepo: true, worktree: false, sourceRepo: "/proj/demo" },
      }),
      { sourceRepo: null },
    );
    assert.deepEqual(
      sourceCacheFromProbe("/tmp/wt", {
        ok: true,
        data: {
          isRepo: true,
          worktree: true,
          sourceRepo: "/tmp/wt",
          branch: "main",
        },
      }),
      { sourceRepo: null },
    );
    const hit = sourceCacheFromProbe("/tmp/wt", {
      ok: true,
      data: {
        isRepo: true,
        worktree: true,
        sourceRepo: "/proj/demo",
        branch: "feat",
        worktreeName: "task",
        worktreeId: "wt-1",
        worktreePath: "/private/tmp/wt",
      },
    });
    assert.equal(hit.sourceRepo, "/proj/demo");
    assert.equal(hit.path, "/private/tmp/wt");
    assert.equal(hit.name, "task");
  });

  it("remembers a per-project default and ignores a corrupt checkbox", () => {
    assert.equal(loadWorktreeChatDefault("/proj/demo"), null);
    saveWorktreeChatDefault("/proj/demo/", {
      enabled: true,
      name: "task",
      ref: "",
    });
    assert.deepEqual(loadWorktreeChatDefault("/proj/demo/"), {
      enabled: true,
      name: "task",
      ref: "",
    });
    store.set(
      DEFAULTS_KEY,
      JSON.stringify({ "/proj/demo/": { enabled: "yes" } }),
    );
    assert.equal(loadWorktreeChatDefault("/proj/demo/"), null);
    store.set(DEFAULTS_KEY, "{not-json");
    assert.equal(loadWorktreeChatDefault("/proj/demo/"), null);
    saveWorktreeChatDefault("", { enabled: true, name: "", ref: "" });
    assert.equal(store.has(SOURCE_CACHE_KEY), false);
  });

  it("replaces the source cache and treats unreadable storage as empty", () => {
    saveWorktreeSourceCache({
      "/proj/demo": { sourceRepo: null },
    });
    assert.deepEqual(loadWorktreeSourceCache(), {
      "/proj/demo": { sourceRepo: null },
    });
    store.set(SOURCE_CACHE_KEY, "{not-json");
    assert.deepEqual(loadWorktreeSourceCache(), {});
  });
});
