/**
 * Context-usage display formatting for the composer ring.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextUsageDisplay,
  buildContextUsageTooltip,
  contextUsageTone,
  formatContextPercent,
  formatTokenCount,
  mergeAvailableModelsPreferContext,
  resolveContextLimit,
} from "@/lib/contextUsageDisplay";

describe("formatTokenCount", () => {
  it("formats plain / k / M scales", () => {
    assert.equal(formatTokenCount(0), "0");
    assert.equal(formatTokenCount(999), "999");
    assert.equal(formatTokenCount(1_000), "1k");
    // One decimal under 100k; whole-k rounding from 100k up (158k, not 157.7k).
    assert.equal(formatTokenCount(12_340), "12.3k");
    assert.equal(formatTokenCount(157_694), "158k");
    assert.equal(formatTokenCount(1_500_000), "1.5M");
  });
});

describe("formatContextPercent", () => {
  it("rounds and allows values over 100", () => {
    assert.equal(formatContextPercent(0), "0%");
    assert.equal(formatContextPercent(9.4), "9.4%");
    assert.equal(formatContextPercent(31.2), "31%");
    assert.equal(formatContextPercent(104.2), "104%");
  });
});

describe("contextUsageTone", () => {
  it("bands idle / ok / warn / danger", () => {
    assert.equal(contextUsageTone(null, false), "idle");
    assert.equal(contextUsageTone(10, true), "ok");
    assert.equal(contextUsageTone(70, true), "warn");
    assert.equal(contextUsageTone(95, true), "danger");
  });
});

describe("resolveContextLimit", () => {
  it("prefers the matching model, then first catalog entry", () => {
    const models = [
      { id: "a", totalContextTokens: 100_000 },
      { id: "b", name: "Grok 4.5", totalContextTokens: 500_000 },
    ];
    assert.equal(resolveContextLimit("b", models), 500_000);
    assert.equal(resolveContextLimit("missing", models), 100_000);
    assert.equal(resolveContextLimit("x", undefined), null);
  });
});

describe("buildContextUsageTooltip", () => {
  it("formats used / remaining and token counts like the Cursor bubble", () => {
    const tip = buildContextUsageTooltip({
      hasUsage: true,
      inputTokens: 25_000,
      contextLimit: 258_000,
      percent: 10,
    });
    assert.equal(tip.title, "Context window");
    assert.equal(tip.percentLine, "10% used (90% remaining)");
    assert.equal(tip.tokensLine, "Used 25k of 258k tokens");
  });
});

describe("buildContextUsageDisplay", () => {
  it("builds a filled ring model with percent and hover tooltip lines", () => {
    const d = buildContextUsageDisplay(
      {
        inputTokens: 157_694,
        outputTokens: 8_433,
        totalTokens: 166_127,
      },
      500_000,
    );
    assert.equal(d.hasUsage, true);
    assert.ok(d.percent != null && Math.abs(d.percent - 31.5388) < 0.01);
    assert.equal(d.fillPercent, Math.min(100, d.percent ?? 0));
    assert.equal(d.tone, "ok");
    assert.equal(d.tooltip.title, "Context window");
    assert.match(d.tooltip.percentLine, /used/);
    assert.match(d.tooltip.percentLine, /remaining/);
    assert.match(d.tooltip.tokensLine, /158k of 500k/);
    assert.match(d.label, /Context window/);
  });

  it("stays idle before the first turn", () => {
    const d = buildContextUsageDisplay(undefined, 500_000);
    assert.equal(d.hasUsage, false);
    assert.equal(d.fillPercent, 0);
    assert.equal(d.tone, "idle");
    assert.match(d.tooltip.percentLine, /0% used/);
    assert.match(d.tooltip.tokensLine, /0 of 500k/);
  });

  it("falls back to No turns yet only when limit and usage are both missing", () => {
    const d = buildContextUsageDisplay(undefined, null);
    assert.equal(d.hasUsage, false);
    assert.equal(d.tooltip.percentLine, "No turns yet");
    assert.match(d.tooltip.tokensLine, /first reply/i);
  });
});

describe("mergeAvailableModelsPreferContext", () => {
  it("fills totalContextTokens from the secondary catalog by id", () => {
    const merged = mergeAvailableModelsPreferContext(
      [{ id: "grok-4.5", name: "Grok 4.5" }],
      [{ id: "grok-4.5", name: "Grok 4.5", totalContextTokens: 500_000 }],
    );
    assert.equal(merged?.[0]?.totalContextTokens, 500_000);
  });

  it("keeps primary tokens when already present", () => {
    const merged = mergeAvailableModelsPreferContext(
      [{ id: "a", totalContextTokens: 100_000 }],
      [{ id: "a", totalContextTokens: 500_000 }],
    );
    assert.equal(merged?.[0]?.totalContextTokens, 100_000);
  });
});
