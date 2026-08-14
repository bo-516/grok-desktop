/**
 * Billing remaining-usage parser (grok-build x.ai/billing).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBillingResponse,
  remainingUsagePercent,
  usagePeriodKind,
  usagePeriodLabel,
} from "../src/sessionBilling.js";

describe("usagePeriodKind / usagePeriodLabel", () => {
  it("maps WEEKLY / MONTHLY proto names and falls back", () => {
    assert.equal(usagePeriodKind("USAGE_PERIOD_TYPE_WEEKLY"), "weekly");
    assert.equal(usagePeriodKind("USAGE_PERIOD_TYPE_MONTHLY"), "monthly");
    assert.equal(usagePeriodKind("USAGE_PERIOD_TYPE_UNSPECIFIED"), "unknown");
    assert.equal(usagePeriodKind(undefined), "unknown");
    assert.equal(usagePeriodLabel("weekly"), "Weekly limit");
    assert.equal(usagePeriodLabel("monthly"), "Monthly limit");
    assert.equal(usagePeriodLabel("unknown"), "Usage");
  });
});

describe("remainingUsagePercent", () => {
  it("is the floor-complement so 99.994% used is 1% left", () => {
    assert.equal(remainingUsagePercent(92), 8);
    assert.equal(remainingUsagePercent(99.994), 1);
    assert.equal(remainingUsagePercent(100), 0);
    assert.equal(remainingUsagePercent(0), 100);
    assert.equal(remainingUsagePercent(-1), 100);
  });
});

describe("parseBillingResponse", () => {
  it("prefers creditUsagePercent and currentPeriod.type", () => {
    const snap = parseBillingResponse({
      config: {
        creditUsagePercent: 92,
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          end: "2026-08-20T12:00:00Z",
        },
      },
    });
    assert.ok(snap);
    assert.equal(snap.usagePercent, 92);
    assert.equal(snap.remainingPercent, 8);
    assert.equal(snap.periodKind, "weekly");
    assert.equal(snap.usageLabel, "Weekly limit");
    assert.equal(snap.periodEndIso, "2026-08-20T12:00:00Z");
    assert.equal(snap.payAsYouGo, false);
  });

  it("falls back to used / monthlyLimit cents and billingPeriodEnd", () => {
    const snap = parseBillingResponse({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: 500 },
        billingPeriodEnd: "2026-09-01T00:00:00Z",
        onDemandCap: { val: 500 },
      },
    });
    assert.ok(snap);
    assert.equal(snap.usagePercent, 25);
    assert.equal(snap.remainingPercent, 75);
    assert.equal(snap.periodKind, "unknown");
    assert.equal(snap.periodEndIso, "2026-09-01T00:00:00Z");
    assert.equal(snap.payAsYouGo, true);
  });

  it("unwraps a result envelope and rejects empty bags", () => {
    const snap = parseBillingResponse({
      result: {
        config: {
          creditUsagePercent: 8,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" },
        },
      },
    });
    assert.ok(snap);
    assert.equal(snap.periodKind, "monthly");
    assert.equal(snap.remainingPercent, 92);
    assert.equal(parseBillingResponse(null), null);
    assert.equal(parseBillingResponse({ config: {} }), null);
    assert.equal(parseBillingResponse({}), null);
  });

  it("treats a post-reset bag with omitted creditUsagePercent as 0% used", () => {
    const snap = parseBillingResponse({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-08-13T14:00:19.995375+00:00",
          end: "2026-08-20T14:00:19.995375+00:00",
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
        isUnifiedBillingUser: true,
        billingPeriodStart: "2026-08-13T14:00:19.995375+00:00",
        billingPeriodEnd: "2026-08-20T14:00:19.995375+00:00",
      },
    });
    assert.ok(snap);
    assert.equal(snap.usagePercent, 0);
    assert.equal(snap.remainingPercent, 100);
    assert.equal(snap.periodKind, "weekly");
    assert.equal(snap.usageLabel, "Weekly limit");
    assert.equal(snap.periodEndIso, "2026-08-20T14:00:19.995375+00:00");
    assert.equal(snap.payAsYouGo, false);
  });
});
