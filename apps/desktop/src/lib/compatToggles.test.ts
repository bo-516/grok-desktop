import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPAT_TOGGLE_COUNT,
  COMPAT_TOGGLES,
  compatTogglesToEnv,
  isFullCompatToggleSet,
} from "./compatToggles.js";

describe("compatToggles", () => {
  it("exports exactly 10 GROK_*_ENABLED switches (F-COMPAT-03)", () => {
    assert.equal(COMPAT_TOGGLES.length, COMPAT_TOGGLE_COUNT);
    assert.equal(COMPAT_TOGGLE_COUNT, 10);
    assert.equal(isFullCompatToggleSet(), true);
    for (const t of COMPAT_TOGGLES) {
      assert.match(t.envKey, /^GROK_.+_ENABLED$/);
    }
  });

  it("maps to 0/1 env", () => {
    const env = compatTogglesToEnv({
      GROK_CLAUDE_SKILLS_ENABLED: false,
      GROK_CURSOR_MCP_ENABLED: true,
    });
    assert.equal(env.GROK_CLAUDE_SKILLS_ENABLED, "0");
    assert.equal(env.GROK_CURSOR_MCP_ENABLED, "1");
  });
});

