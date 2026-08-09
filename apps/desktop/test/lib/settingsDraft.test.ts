/**
 * Unit tests for Settings SPAWN dirty detection (shipped helpers).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultSettingsDraft,
  isSettingsDraftDirty,
  settingsDraftEqual,
} from "@/lib/settingsDraft";

describe("settingsDraft", () => {
  it("createDefaultSettingsDraft is clean against itself", () => {
    const d = createDefaultSettingsDraft({ GROK_X: true });
    assert.equal(isSettingsDraftDirty(d, d), false);
    assert.equal(settingsDraftEqual(d, { ...d, compat: { GROK_X: true } }), true);
  });

  it("sandbox change marks dirty", () => {
    const applied = createDefaultSettingsDraft({});
    const draft = { ...applied, sandbox: "workspace" as const };
    assert.equal(isSettingsDraftDirty(draft, applied), true);
  });

  it("compat flip marks dirty", () => {
    const applied = createDefaultSettingsDraft({ A: true, B: false });
    const draft = {
      ...applied,
      compat: { A: false, B: false },
    };
    assert.equal(isSettingsDraftDirty(draft, applied), true);
  });

  it("identical drafts with reordered compat keys are equal", () => {
    const a = createDefaultSettingsDraft({ Z: true, A: false });
    const b = {
      ...a,
      compat: { A: false, Z: true },
    };
    assert.equal(settingsDraftEqual(a, b), true);
  });
});
