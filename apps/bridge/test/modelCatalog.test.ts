/**
 * Pool catalog reuse. Does not spawn grok — an empty pool would.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  pickPoolCatalog,
  poolNeedsCatalogWait,
  readModelCatalog,
} from "../src/modelCatalog.js";
import { RuntimePool, type PooledRuntime } from "../src/runtimePool.js";

function runtimeWithCatalog(): PooledRuntime {
  const state = createSessionState({
    id: "s1",
    workspace: "/w",
    model: "grok-4.7",
  });
  state.availableModels = [{ id: "grok-4.7", name: "Grok 4.7" }];
  state.configOptions = [{ id: "model", currentValue: "grok-4.7" }];
  return {
    sessionId: "s1",
    cwd: "/w",
    lastUsed: 1,
    getStatus: () => "idle",
    getSessionState: () => state,
    prompt: async () => undefined,
    cancel: () => undefined,
    respondPermission: () => undefined,
    dispose: () => undefined,
  };
}

describe("model catalog pool reuse", () => {
  it("does not wait when the pool is empty", () => {
    assert.equal(poolNeedsCatalogWait(0, 0), false);
    assert.equal(poolNeedsCatalogWait(1, 0), true);
    assert.equal(poolNeedsCatalogWait(0, 1), true);
    assert.equal(pickPoolCatalog([]), null);
  });

  it("returns a resident catalog without spawning", async () => {
    const pool = new RuntimePool(2);
    await pool.insert(runtimeWithCatalog());
    const snap = await readModelCatalog(pool, "/w");
    assert.equal(snap.model, "grok-4.7");
    assert.equal(snap.availableModels[0]?.id, "grok-4.7");
    assert.equal(snap.configOptions.length, 1);
  });

  it("waits for an in-flight handshake instead of spawning", async () => {
    const pool = new RuntimePool(2);
    await pool.beginSpawn();
    const pending = readModelCatalog(pool, "/w");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await pool.insert(runtimeWithCatalog());
    const snap = await pending;
    assert.equal(snap.model, "grok-4.7");
    assert.equal(snap.availableModels.length, 1);
  });
});
