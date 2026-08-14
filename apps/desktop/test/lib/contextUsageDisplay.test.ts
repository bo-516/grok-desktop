/**
 * Context-usage display formatting for the composer pie.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextUsageDisplay,
  buildContextUsageTooltip,
  contextUsageTone,
  formatContextPercent,
  formatTokenCount,
  formatTurnUsageLine,
  hasBilledTurnUsage,
  isContextUsageReady,
  contextUsagePiePath,
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

describe("contextUsagePiePath", () => {
  it("returns empty when there is nothing to fill", () => {
    assert.equal(contextUsagePiePath(0, 10, 10, 8), "");
    assert.equal(contextUsagePiePath(-1, 10, 10, 8), "");
    assert.equal(contextUsagePiePath(25, 10, 10, 0), "");
  });

  it("sweeps a solid sector from 12 o'clock clockwise", () => {
    assert.equal(
      contextUsagePiePath(25, 10, 10, 8),
      "M 10 10 L 10 2 A 8 8 0 0 1 18 10 Z",
    );
    assert.equal(
      contextUsagePiePath(50, 10, 10, 8),
      "M 10 10 L 10 2 A 8 8 0 0 1 10 18 Z",
    );
    assert.equal(
      contextUsagePiePath(75, 10, 10, 8),
      "M 10 10 L 10 2 A 8 8 0 1 1 2 10 Z",
    );
  });

  it("uses two semicircle arcs for a full disk", () => {
    assert.equal(
      contextUsagePiePath(100, 10, 10, 8),
      "M 10 2 A 8 8 0 1 1 10 18 A 8 8 0 1 1 10 2 Z",
    );
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

describe("isContextUsageReady", () => {
  it("hides the pie until occupancy is a positive count", () => {
    assert.equal(isContextUsageReady(undefined), false);
    assert.equal(isContextUsageReady(null), false);
    assert.equal(
      isContextUsageReady({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }),
      false,
    );
    assert.equal(
      isContextUsageReady({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokensUsed: 0,
      }),
      false,
    );
  });

  it("accepts live occupancy or billed-input fallback", () => {
    assert.equal(
      isContextUsageReady({
        inputTokens: 131_000,
        outputTokens: 0,
        totalTokens: 131_000,
        contextTokensUsed: 131_000,
      }),
      true,
    );
    assert.equal(
      isContextUsageReady({
        inputTokens: 12_000,
        outputTokens: 400,
        totalTokens: 12_400,
      }),
      true,
    );
  });
});

describe("hasBilledTurnUsage", () => {
  it("rejects occupancy-only bags copied into input/total", () => {
    assert.equal(hasBilledTurnUsage(undefined), false);
    assert.equal(
      hasBilledTurnUsage({
        inputTokens: 131_000,
        outputTokens: 0,
        totalTokens: 131_000,
        contextTokensUsed: 131_000,
      }),
      false,
    );
  });

  it("accepts last-turn billed rollups even when occupancy matches input", () => {
    assert.equal(
      hasBilledTurnUsage({
        inputTokens: 157_694,
        outputTokens: 8_433,
        totalTokens: 166_127,
        contextTokensUsed: 157_694,
      }),
      true,
    );
    assert.equal(
      hasBilledTurnUsage({
        inputTokens: 1_200_000,
        outputTokens: 0,
        totalTokens: 1_200_000,
        modelCalls: 3,
        contextTokensUsed: 131_000,
      }),
      true,
    );
  });
});

describe("formatTurnUsageLine", () => {
  it("formats billed total with in/out split", () => {
    assert.equal(
      formatTurnUsageLine({
        inputTokens: 157_694,
        outputTokens: 8_433,
        totalTokens: 166_127,
      }),
      "166k tokens (158k in · 8.4k out)",
    );
  });
});

describe("buildContextUsageTooltip", () => {
  it("formats occupancy as fill, not billed token usage", () => {
    const tip = buildContextUsageTooltip({
      hasUsage: true,
      hasTurnUsage: false,
      occupancyTokens: 25_000,
      billedInputTokens: 0,
      billedOutputTokens: 0,
      billedTotalTokens: 0,
      contextLimit: 258_000,
      percent: 10,
    });
    assert.equal(tip.title, "Context window");
    assert.equal(tip.percentLine, "10% occupied (90% remaining)");
    assert.equal(tip.occupancyLine, "25k of 258k filled");
    assert.equal(tip.usageTitle, undefined);
    assert.equal(tip.usageLine, undefined);
  });

  it("adds a last-turn usage section when billed counters exist", () => {
    const tip = buildContextUsageTooltip({
      hasUsage: true,
      hasTurnUsage: true,
      occupancyTokens: 131_000,
      billedInputTokens: 1_200_000,
      billedOutputTokens: 50,
      billedTotalTokens: 1_200_050,
      contextLimit: 500_000,
      percent: 26.2,
    });
    assert.equal(tip.occupancyLine, "131k of 500k filled");
    assert.equal(tip.usageTitle, "Last turn usage");
    assert.equal(tip.usageLine, "1.2M tokens (1.2M in · 50 out)");
  });
});

describe("buildContextUsageDisplay", () => {
  it("builds a filled ring model with occupancy and last-turn usage", () => {
    const d = buildContextUsageDisplay(
      {
        inputTokens: 157_694,
        outputTokens: 8_433,
        totalTokens: 166_127,
      },
      500_000,
    );
    assert.equal(d.hasUsage, true);
    assert.equal(d.hasTurnUsage, true);
    assert.ok(d.percent != null && Math.abs(d.percent - 31.5388) < 0.01);
    assert.equal(d.fillPercent, Math.min(100, d.percent ?? 0));
    assert.equal(d.tone, "ok");
    assert.equal(d.tooltip.title, "Context window");
    assert.match(d.tooltip.percentLine, /occupied/);
    assert.match(d.tooltip.percentLine, /remaining/);
    assert.match(d.tooltip.occupancyLine, /158k of 500k filled/);
    assert.doesNotMatch(d.tooltip.occupancyLine, /used/i);
    assert.equal(d.tooltip.usageTitle, "Last turn usage");
    assert.equal(d.tooltip.usageLine, "166k tokens (158k in · 8.4k out)");
    assert.match(d.label, /Context window/);
    assert.match(d.label, /Last turn usage/);
  });

  it("uses live occupancy instead of billed inputTokens when both exist", () => {
    const d = buildContextUsageDisplay(
      {
        inputTokens: 1_200_000,
        outputTokens: 50,
        totalTokens: 1_200_050,
        contextTokensUsed: 131_000,
      },
      500_000,
    );
    assert.equal(d.inputTokens, 131_000);
    assert.ok(d.percent != null && Math.abs(d.percent - 26.2) < 0.05);
    assert.match(d.tooltip.occupancyLine, /131k of 500k filled/);
    assert.equal(d.tooltip.usageLine, "1.2M tokens (1.2M in · 50 out)");
  });

  it("hides billed usage for occupancy-only snapshots", () => {
    const d = buildContextUsageDisplay(
      {
        inputTokens: 158_000,
        outputTokens: 0,
        totalTokens: 158_000,
        contextTokensUsed: 158_000,
      },
      500_000,
    );
    assert.equal(d.hasTurnUsage, false);
    assert.match(d.tooltip.occupancyLine, /158k of 500k filled/);
    assert.equal(d.tooltip.usageLine, undefined);
  });

  it("stays idle before the first turn", () => {
    const d = buildContextUsageDisplay(undefined, 500_000);
    assert.equal(d.hasUsage, false);
    assert.equal(d.hasTurnUsage, false);
    assert.equal(d.fillPercent, 0);
    assert.equal(d.tone, "idle");
    assert.match(d.tooltip.percentLine, /0% occupied/);
    assert.match(d.tooltip.occupancyLine, /0 of 500k filled/);
    // Composer must not mount this idle model — 0 of 500k is "not loaded".
    assert.equal(isContextUsageReady(undefined), false);
  });

  it("falls back to a compact No turns yet tip when limit and usage are both missing", () => {
    const d = buildContextUsageDisplay(undefined, null);
    assert.equal(d.hasUsage, false);
    assert.equal(d.tooltip.percentLine, "No turns yet");
    assert.equal(d.tooltip.occupancyLine, "");
    assert.doesNotMatch(d.label, /occupancy updates/i);
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

  it("fills reasoningEfforts from the secondary catalog by id", () => {
    const merged = mergeAvailableModelsPreferContext(
      [{ id: "grok-4.6", name: "Grok 4.6" }],
      [
        {
          id: "grok-4.6",
          reasoningEfforts: [{ id: "xhigh", default: true }],
        },
      ],
    );
    assert.equal(merged?.[0]?.reasoningEfforts?.[0]?.id, "xhigh");
  });
});
