/**
 * Local CLI / login probe helpers used by the environment banner.
 * Does not spawn grok — only capacity bounds and auth-source priority.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  defaultAuthJsonPath,
  poolCapacityFromEnv,
  probeAuthSource,
} from "../src/environment.js";

/** HOME before this file mutated it (Unix home for auth.json). */
const prevHome = process.env.HOME;
/** USERPROFILE before this file mutated it (Windows home fallback). */
const prevProfile = process.env.USERPROFILE;
/** XAI_API_KEY before this file mutated it. */
const prevKey = process.env.XAI_API_KEY;
/** BRIDGE_POOL_CAPACITY before this file mutated it. */
const prevCap = process.env.BRIDGE_POOL_CAPACITY;

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  if (prevProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = prevProfile;
  }
  if (prevKey === undefined) {
    delete process.env.XAI_API_KEY;
  } else {
    process.env.XAI_API_KEY = prevKey;
  }
  if (prevCap === undefined) {
    delete process.env.BRIDGE_POOL_CAPACITY;
  } else {
    process.env.BRIDGE_POOL_CAPACITY = prevCap;
  }
});

describe("poolCapacityFromEnv", () => {
  it("defaults to 8 and clamps to [1, 16]", () => {
    delete process.env.BRIDGE_POOL_CAPACITY;
    assert.equal(poolCapacityFromEnv(), 8);
    process.env.BRIDGE_POOL_CAPACITY = "4";
    assert.equal(poolCapacityFromEnv(), 4);
    process.env.BRIDGE_POOL_CAPACITY = "99";
    assert.equal(poolCapacityFromEnv(), 16);
    process.env.BRIDGE_POOL_CAPACITY = "0";
    assert.equal(poolCapacityFromEnv(), 8);
    process.env.BRIDGE_POOL_CAPACITY = "nope";
    assert.equal(poolCapacityFromEnv(), 8);
  });
});

describe("probeAuthSource", () => {
  it("prefers a non-empty XAI_API_KEY over a cached token file", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-env-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XAI_API_KEY = "sk-test";
    const probed = probeAuthSource();
    assert.equal(probed.authed, true);
    assert.equal(probed.authSource, "xai_api_key");
    assert.equal(probed.authPathChecked, defaultAuthJsonPath());
  });

  it("uses cached_token when auth.json exists and the env key is empty", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-env-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.XAI_API_KEY;
    mkdirSync(join(home, ".grok"), { recursive: true });
    writeFileSync(join(home, ".grok", "auth.json"), "{}", "utf8");
    const probed = probeAuthSource();
    assert.equal(probed.authed, true);
    assert.equal(probed.authSource, "cached_token");
    assert.equal(probed.authPathChecked, join(home, ".grok", "auth.json"));
  });

  it("reports none when neither env key nor auth.json is present", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-env-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.XAI_API_KEY;
    const probed = probeAuthSource();
    assert.equal(probed.authed, false);
    assert.equal(probed.authSource, "none");
  });
});
