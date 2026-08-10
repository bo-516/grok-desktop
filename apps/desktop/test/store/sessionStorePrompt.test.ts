/**
 * Deferred New chat create helpers: wait for canvas id after forceNew.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitForCanvasSessionId } from "@/store/sessionStorePrompt";
import type { SessionStore } from "@/store/sessionStoreTypes";
import { createSessionState } from "@grok-desktop/acp-core";

/**
 * Minimal get() stub for waitForCanvasSessionId.
 * @param id Canvas session id to report.
 */
function makeGet(id: string): () => SessionStore {
  return () =>
    ({
      session: createSessionState({ id, workspace: "/w" }),
    }) as SessionStore;
}

describe("waitForCanvasSessionId", () => {
  it("returns immediately when session.id is already set", async () => {
    const sid = await waitForCanvasSessionId(makeGet("sess-ready"), 200);
    assert.equal(sid, "sess-ready");
  });

  it("resolves when session.id appears after a short delay", async () => {
    let id = "";
    const get = () =>
      ({
        session: createSessionState({ id, workspace: "/w" }),
      }) as SessionStore;
    const wait = waitForCanvasSessionId(get, 2_000);
    setTimeout(() => {
      id = "sess-late";
    }, 60);
    const sid = await wait;
    assert.equal(sid, "sess-late");
  });

  it("returns null on timeout when id never appears", async () => {
    const sid = await waitForCanvasSessionId(makeGet(""), 120);
    assert.equal(sid, null);
  });
});
