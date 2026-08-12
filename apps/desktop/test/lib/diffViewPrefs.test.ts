/**
 * Diff view prefs normalize / round-trip helpers (doc §7: wrap default true).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PREFS,
  normalizeDiffViewPrefs,
  patchDiffViewPrefs,
} from "@/lib/diffViewPrefs";

describe("diffViewPrefs", () => {
  it("DEFAULT_PREFS.wrap === true", () => {
    assert.equal(DEFAULT_PREFS.wrap, true);
  });

  /** Product: dual line-number gutters stay opt-in (default off). */
  it("DEFAULT_PREFS.dualGutter === false", () => {
    assert.equal(DEFAULT_PREFS.dualGutter, false);
  });

  it("normalize falls back to defaults on garbage", () => {
    assert.deepEqual(normalizeDiffViewPrefs(null), {
      wrap: true,
      dualGutter: false,
      preferFullFile: false,
    });
    assert.deepEqual(normalizeDiffViewPrefs("x"), {
      wrap: true,
      dualGutter: false,
      preferFullFile: false,
    });
  });

  it("normalize accepts true flags and explicit wrap false", () => {
    assert.deepEqual(
      normalizeDiffViewPrefs({
        wrap: true,
        dualGutter: true,
        preferFullFile: true,
      }),
      { wrap: true, dualGutter: true, preferFullFile: true },
    );
    assert.deepEqual(
      normalizeDiffViewPrefs({ wrap: false, dualGutter: 1 }),
      { wrap: false, dualGutter: false, preferFullFile: false },
    );
    // Non-boolean wrap falls back to default true.
    assert.deepEqual(
      normalizeDiffViewPrefs({ wrap: "yes", dualGutter: true }),
      { wrap: true, dualGutter: true, preferFullFile: false },
    );
  });

  it("patchDiffViewPrefs merges fields", () => {
    const next = patchDiffViewPrefs(
      { wrap: true, dualGutter: false, preferFullFile: false },
      { dualGutter: true },
    );
    assert.deepEqual(next, {
      wrap: true,
      dualGutter: true,
      preferFullFile: false,
    });
  });
});
