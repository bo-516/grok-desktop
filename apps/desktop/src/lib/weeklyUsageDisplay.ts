/**
 * Pure display helpers for the composer weekly-remaining chip.
 * Purpose: format SessionBillingSnapshot into chip text / tooltip / tone
 * without React or store coupling.
 * Boundary: no I/O; callers supply an already-parsed billing snapshot.
 */

import type { SessionBillingSnapshot } from "@grok-desktop/acp-core";

/** Severity bands for remaining allowance (low remaining = warn / danger). */
export type WeeklyUsageTone = "ok" | "warn" | "danger";

/**
 * Multi-line hover tip for the weekly remaining chip.
 * Lines are preformatted; the view only maps them into the tip layout.
 */
export type WeeklyUsageTooltip = {
  /** First line heading, e.g. "Weekly limit". */
  title: string;
  /** Remaining line, e.g. "8% left". */
  remainingLine: string;
  /** Optional reset line when the agent supplied a period end. */
  resetLine?: string;
};

/** View-model for ComposerWeeklyUsageView. */
export type WeeklyUsageDisplay = {
  /** Remaining included-allowance percent (integer 0–100). */
  remainingPercent: number;
  /** Used included-allowance percent (raw, may exceed 100). */
  usagePercent: number;
  /** Period word on the chip, e.g. "Weekly". */
  periodWord: string;
  /** Compact chip text, e.g. "Weekly 8%". */
  chipLabel: string;
  /** Screen-reader label (title + remaining + reset). */
  label: string;
  /** Structured hover bubble. */
  tooltip: WeeklyUsageTooltip;
  /** Color band for the remaining number. */
  tone: WeeklyUsageTone;
};

/**
 * Map remaining percent to a tone (danger ≤5 / warn ≤10 / ok otherwise).
 * Matches grok-build's usage_warning critical/grey split, plus a healthy band
 * so the always-on chip is not permanently yellow.
 * @param remainingPercent Integer remaining in [0, 100].
 */
export function weeklyUsageTone(remainingPercent: number): WeeklyUsageTone {
  if (remainingPercent <= 5) {
    return "danger";
  }
  if (remainingPercent <= 10) {
    return "warn";
  }
  return "ok";
}

/**
 * Short period word for the chip ("Weekly" / "Monthly" / "Usage").
 * @param usageLabel Snapshot usageLabel from grok-build ("Weekly limit").
 */
export function weeklyChipPeriodWord(usageLabel: string): string {
  const trimmed = usageLabel.trim();
  if (trimmed.endsWith(" limit")) {
    return trimmed.slice(0, -" limit".length);
  }
  return trimmed || "Usage";
}

/**
 * Format a period-end ISO timestamp for the hover tip.
 * @param iso RFC 3339 string; invalid dates return null so the line is omitted.
 */
export function formatWeeklyReset(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/**
 * Build the composer weekly-remaining view-model from a billing snapshot.
 * @param snap Parsed `_x.ai/billing` snapshot.
 */
export function buildWeeklyUsageDisplay(
  snap: SessionBillingSnapshot,
): WeeklyUsageDisplay {
  const remainingPercent = snap.remainingPercent;
  const periodWord = weeklyChipPeriodWord(snap.usageLabel);
  const chipLabel = `${periodWord} ${remainingPercent}%`;
  const remainingLine = `${remainingPercent}% left`;
  const reset =
    snap.periodEndIso != null ? formatWeeklyReset(snap.periodEndIso) : null;
  const tooltip: WeeklyUsageTooltip = {
    title: snap.usageLabel,
    remainingLine,
  };
  if (reset) {
    tooltip.resetLine = `Resets ${reset}`;
  }
  const label = [tooltip.title, tooltip.remainingLine, tooltip.resetLine]
    .filter(Boolean)
    .join(" · ");
  return {
    remainingPercent,
    usagePercent: snap.usagePercent,
    periodWord,
    chipLabel,
    label,
    tooltip,
    tone: weeklyUsageTone(remainingPercent),
  };
}
