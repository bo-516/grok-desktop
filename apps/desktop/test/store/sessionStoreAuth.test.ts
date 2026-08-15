/**
 * Auth probe reducer: idempotent ticks, flip semantics, environment follow-up.
 * The 3s poll calls this twenty times a minute — silence on repeat is the
 * contract, not an optimization detail.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthProbe, EnvironmentInfo } from "@/bridge/liveBridge";
import {
  applyAuthProbe,
  authedFromEnvironment,
} from "@/store/sessionStoreAuth";

/**
 * Build a probe payload.
 * @param authed Login flag under test.
 * @returns AuthProbe with a plausible source for that flag.
 */
function probe(authed: boolean): AuthProbe {
  return {
    authed,
    authSource: authed ? "cached_token" : "none",
    authPathChecked: "/home/u/.grok/auth.json",
  };
}

/**
 * Minimal store double: records patches and environment-refresh calls.
 * @param authed Seed value for the previous flag (null = never probed).
 * @returns set / get pair plus the recorded effects.
 */
function makeStore(authed: boolean | null) {
  const patches: Array<Record<string, unknown>> = [];
  const state = {
    authed,
    live: {
      checkEnvironment: () => {
        state.envRefreshes += 1;
        return true;
      },
    },
    envRefreshes: 0,
  };
  return {
    patches,
    state,
    set: (patch: Record<string, unknown>) => {
      patches.push(patch);
      Object.assign(state, patch);
    },
    get: () => state,
  };
}

describe("auth probe reducer", () => {
  it("writes nothing when the flag is unchanged", () => {
    const store = makeStore(true);
    applyAuthProbe(store.set, store.get, probe(true));
    assert.equal(store.patches.length, 0);
    assert.equal(store.state.envRefreshes, 0);
  });

  it("adopts the first probe without a redundant environment refetch", () => {
    const store = makeStore(null);
    applyAuthProbe(store.set, store.get, probe(false));
    assert.deepEqual(store.patches, [{ authed: false }]);
    // connect already requests check_environment — do not double it.
    assert.equal(store.state.envRefreshes, 0);
  });

  it("flips to signed out and refreshes the environment banner", () => {
    const store = makeStore(true);
    applyAuthProbe(store.set, store.get, probe(false));
    assert.deepEqual(store.patches, [{ authed: false }]);
    assert.equal(store.state.envRefreshes, 1);
  });

  it("flips to signed in and refreshes the environment banner", () => {
    const store = makeStore(false);
    applyAuthProbe(store.set, store.get, probe(true));
    assert.deepEqual(store.patches, [{ authed: true }]);
    assert.equal(store.state.envRefreshes, 1);
  });

  it("stays quiet across a long run of repeat ticks", () => {
    const store = makeStore(false);
    for (let i = 0; i < 20; i += 1) {
      applyAuthProbe(store.set, store.get, probe(false));
    }
    assert.equal(store.patches.length, 0);
  });

  it("reads the same flag out of a full environment probe", () => {
    const env: EnvironmentInfo = {
      grokPath: "/usr/local/bin/grok",
      version: "1.2.3",
      authed: true,
      authSource: "cached_token",
      authPathChecked: "/home/u/.grok/auth.json",
      ok: true,
      message: "grok ready",
      poolCapacity: 8,
    };
    assert.equal(authedFromEnvironment(env), true);
    assert.equal(authedFromEnvironment({ ...env, authed: false }), false);
  });
});
