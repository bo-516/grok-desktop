/**
 * Weekly remaining-usage chip formatting.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionBillingSnapshot } from "@grok-desktop/acp-core";
import {
  buildWeeklyUsageDisplay,
  weeklyChipPeriodWord,
  weeklyUsageTone,
} from "@/lib/weeklyUsageDisplay";

/**
 * Billing snapshot with weekly 8% remaining; tests override individual fields.
 * @param patch Field overrides on top of the 92%-used weekly fixture.
 */
function snap(
  patch: Partial<SessionBillingSnapshot>,
): SessionBillingSnapshot {
  return {
    usagePercent: 92,
    remainingPercent: 8,
    periodKind: "weekly",
    usageLabel: "Weekly limit",
    payAsYouGo: false,
    ...patch,
  };
}

describe("weeklyUsageTone", () => {
  it("bands remaining: ok / warn ≤10 / danger ≤5", () => {
    assert.equal(weeklyUsageTone(92), "ok");
    assert.equal(weeklyUsageTone(10), "warn");
    assert.equal(weeklyUsageTone(8), "warn");
    assert.equal(weeklyUsageTone(5), "danger");
    assert.equal(weeklyUsageTone(0), "danger");
  });
});

describe("weeklyChipPeriodWord", () => {
  it("strips the trailing limit noun", () => {
    assert.equal(weeklyChipPeriodWord("Weekly limit"), "Weekly");
    assert.equal(weeklyChipPeriodWord("Monthly limit"), "Monthly");
    assert.equal(weeklyChipPeriodWord("Usage"), "Usage");
  });
});

describe("buildWeeklyUsageDisplay", () => {
  it("builds a remaining chip + TUI-aligned tooltip", () => {
    const d = buildWeeklyUsageDisplay(snap({}));
    assert.equal(d.periodWord, "Weekly");
    assert.equal(d.chipLabel, "Weekly 8%");
    assert.equal(d.tooltip.title, "Weekly limit");
    assert.equal(d.tooltip.remainingLine, "8% left");
    assert.equal(d.tone, "warn");
    assert.match(d.label, /Weekly limit/);
    assert.match(d.label, /8% left/);
  });

  it("includes a reset line when periodEndIso is valid", () => {
    const d = buildWeeklyUsageDisplay(
      snap({ periodEndIso: "2026-08-20T12:00:00Z" }),
    );
    assert.ok(d.tooltip.resetLine);
    assert.match(d.tooltip.resetLine, /Resets /);
  });

  it("omits the reset line for an invalid period end", () => {
    const d = buildWeeklyUsageDisplay(snap({ periodEndIso: "not-a-date" }));
    assert.equal(d.tooltip.resetLine, undefined);
  });

  it("falls back to Usage when the period noun is blank", () => {
    const d = buildWeeklyUsageDisplay(snap({ usageLabel: "   " }));
    assert.equal(d.periodWord, "Usage");
    assert.equal(d.chipLabel, "Usage 8%");
  });
});
