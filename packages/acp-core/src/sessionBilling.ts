/**
 * Parse grok-build `_x.ai/billing` (x.ai/billing extension) into a snapshot.
 * Purpose: turn the authenticated credits-config bag into remaining weekly /
 * monthly allowance figures the composer chrome can show without I/O.
 * Boundary: no network; callers supply the raw JSON-RPC result. Missing or
 * unparseable bags return null so the UI keeps last-known-good instead of
 * flashing zeros.
 */

/** Period kind derived from proto enum names such as USAGE_PERIOD_TYPE_WEEKLY. */
export type UsagePeriodKind = "weekly" | "monthly" | "unknown";

/**
 * Account-level included-allowance snapshot from `x.ai/billing`.
 * Remaining is the floor-complement of usage so it matches grok-build TUI
 * ("99.994% used" → "1% left", never "0% left" until truly exhausted).
 */
export type SessionBillingSnapshot = {
  /** Included-allowance usage percent (clamped to ≥ 0). */
  usagePercent: number;
  /** 100 − floor(usage), never negative. */
  remainingPercent: number;
  /** Weekly / monthly / unknown — drives the chrome label. */
  periodKind: UsagePeriodKind;
  /**
   * TUI-aligned noun for the allowance: "Weekly limit" / "Monthly limit" /
   * "Usage" when the period type is missing or unspecified.
   */
  usageLabel: string;
  /** RFC 3339 period end when the agent supplied one. */
  periodEndIso?: string;
  /** True when an on-demand (pay-as-you-go) cap is present and > 0. */
  payAsYouGo: boolean;
};

/**
 * Map a proto period-type string to a stable kind.
 * @param periodType Raw `currentPeriod.type` (e.g. USAGE_PERIOD_TYPE_WEEKLY).
 * @returns weekly / monthly, or unknown when absent / unspecified.
 */
export function usagePeriodKind(
  periodType: string | null | undefined,
): UsagePeriodKind {
  if (!periodType) {
    return "unknown";
  }
  if (periodType.includes("WEEKLY")) {
    return "weekly";
  }
  if (periodType.includes("MONTHLY")) {
    return "monthly";
  }
  return "unknown";
}

/**
 * TUI noun for the included-allowance meter (matches credit_bar::usage_label).
 * @param kind Period kind from {@link usagePeriodKind}.
 * @returns "Weekly limit" / "Monthly limit" / "Usage".
 */
export function usagePeriodLabel(kind: UsagePeriodKind): string {
  if (kind === "weekly") {
    return "Weekly limit";
  }
  if (kind === "monthly") {
    return "Monthly limit";
  }
  return "Usage";
}

/**
 * Remaining percent as grok-build renders it: complement of floored usage.
 * @param usagePercent Raw usage 0–∞; NaN / negative treated as 0.
 * @returns Integer remaining in [0, 100].
 */
export function remainingUsagePercent(usagePercent: number): number {
  if (!Number.isFinite(usagePercent) || usagePercent < 0) {
    return 100;
  }
  const used = Math.floor(usagePercent);
  return Math.max(0, 100 - used);
}

/**
 * Read a finite number from a billing Cent `{ val }` or a bare number.
 * @param raw Untrusted field; strings and NaN are rejected.
 * @returns Finite number, or undefined when absent / invalid.
 */
function readCentVal(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const val = (raw as { val?: unknown }).val;
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }
  return undefined;
}

/**
 * Read a finite non-negative percent from an untrusted field.
 * @param raw Protocol number; strings and NaN are rejected.
 * @returns Finite number, or undefined when absent / invalid.
 */
function readNumber(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return raw;
}

/**
 * Unwrap `{ result: T }` envelopes some in-process ACP clients add.
 * @param raw JSON-RPC result or `{ result: … }` wrapper.
 * @returns Inner object when present; otherwise the original value.
 */
function unwrapResultEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const rec = raw as Record<string, unknown>;
  if (rec.config !== undefined) {
    return raw;
  }
  if (rec.result !== undefined) {
    return rec.result;
  }
  return raw;
}

/**
 * True when the credits bag is a real account snapshot that simply omitted
 * the usage percent. Proto3 JSON drops zero scalars, so a fresh weekly reset
 * arrives with `currentPeriod` but no `creditUsagePercent` — treat that as 0%
 * used (same as grok-build's credit bar) instead of hiding the chip.
 * Empty `{}` stays false so a failed fetch does not invent 100% remaining.
 * @param config Inner `config` object from `_x.ai/billing`.
 */
function billingBagAllowsZeroUsage(config: Record<string, unknown>): boolean {
  const period = config.currentPeriod;
  if (period && typeof period === "object" && !Array.isArray(period)) {
    return true;
  }
  if (
    typeof config.billingPeriodEnd === "string" &&
    config.billingPeriodEnd.trim()
  ) {
    return true;
  }
  return typeof config.isUnifiedBillingUser === "boolean";
}

/**
 * Parse a grok-build `x.ai/billing` result into a remaining-usage snapshot.
 * Prefers `creditUsagePercent` + `currentPeriod`; falls back to deprecated
 * `used` / `monthlyLimit` / `billingPeriodEnd` so both backend shapes work.
 * A period-bearing bag with no percent (proto3 omitted 0 after reset) is 0%
 * used / 100% remaining — not a parse failure.
 * @param raw Untrusted JSON-RPC result from `_x.ai/billing`.
 * @returns Snapshot when a usage percent can be derived; otherwise null.
 */
export function parseBillingResponse(
  raw: unknown,
): SessionBillingSnapshot | null {
  const root = unwrapResultEnvelope(raw);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return null;
  }
  const bag = root as Record<string, unknown>;
  const configRaw = bag.config;
  if (!configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) {
    return null;
  }
  const config = configRaw as Record<string, unknown>;

  const creditPct = readNumber(config.creditUsagePercent);
  const limit = readCentVal(config.monthlyLimit);
  const used = readCentVal(config.used);
  let usagePercent: number | undefined;
  if (creditPct !== undefined) {
    usagePercent = Math.max(0, creditPct);
  } else if (
    limit !== undefined &&
    used !== undefined &&
    Math.abs(limit) > 0
  ) {
    usagePercent = Math.max(0, (Math.abs(used) / Math.abs(limit)) * 100);
  } else if (billingBagAllowsZeroUsage(config)) {
    usagePercent = 0;
  }
  if (usagePercent === undefined) {
    return null;
  }

  const periodRaw = config.currentPeriod;
  let periodType: string | undefined;
  let periodEndIso: string | undefined;
  if (periodRaw && typeof periodRaw === "object" && !Array.isArray(periodRaw)) {
    const period = periodRaw as Record<string, unknown>;
    if (typeof period.type === "string" && period.type.trim()) {
      periodType = period.type;
    }
    if (typeof period.end === "string" && period.end.trim()) {
      periodEndIso = period.end.trim();
    }
  }
  if (
    !periodEndIso &&
    typeof config.billingPeriodEnd === "string" &&
    config.billingPeriodEnd.trim()
  ) {
    periodEndIso = config.billingPeriodEnd.trim();
  }

  const periodKind = usagePeriodKind(periodType);
  const onDemandCap = readCentVal(config.onDemandCap);
  const payAsYouGo = onDemandCap !== undefined && Math.abs(onDemandCap) > 0;
  const remainingPercent = remainingUsagePercent(usagePercent);

  const out: SessionBillingSnapshot = {
    usagePercent,
    remainingPercent,
    periodKind,
    usageLabel: usagePeriodLabel(periodKind),
    payAsYouGo,
  };
  if (periodEndIso) {
    out.periodEndIso = periodEndIso;
  }
  return out;
}
