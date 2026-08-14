/**
 * Pure display helpers for the composer context-usage pie.
 * Purpose: format occupancy / percent / last-turn billed usage from
 * SessionTokenUsage + model totalContextTokens without React or store coupling.
 * Boundary: no I/O; callers supply already-reduced session fields.
 */

import {
  contextTokensForWindow,
  contextUsagePercent,
  type AvailableModel,
  type SessionTokenUsage,
} from "@grok-desktop/acp-core";

/** Severity bands for the meter fill color (matches weekly chip: muted / warning / danger). */
export type ContextUsageTone = "idle" | "ok" | "warn" | "danger";

/**
 * Multi-line hover tip for the context pie (Cursor-style bubble).
 * Occupancy (window fill) and last-turn billed usage are separate sections
 * so "tokens used" is never read as context occupancy.
 * Lines are preformatted; the view only maps them into the tip layout.
 */
export type ContextUsageTooltip = {
  /** First line heading, e.g. "Context window". */
  title: string;
  /** Occupancy percent, e.g. "10% occupied (90% remaining)". */
  percentLine: string;
  /**
   * Occupancy counts, e.g. "25k of 258k filled" — not billed usage.
   * Empty when the window size is unknown and there is no occupancy yet
   * so the empty-state tip stays a compact two-line bubble.
   */
  occupancyLine: string;
  /** Billed-usage heading when last-turn counters exist ("Last turn usage"). */
  usageTitle?: string;
  /** Billed-usage line, e.g. "166k tokens (158k in · 8.4k out)". */
  usageLine?: string;
};

/** View-model for ComposerContextUsageView. */
export type ContextUsageDisplay = {
  /** Context-window occupancy (live mid-turn, else last-turn input); 0 when none. */
  inputTokens: number;
  /** Last-turn total tokens (in + out). */
  totalTokens: number;
  /** Last-turn output tokens. */
  outputTokens: number;
  /** Model context window size when known. */
  contextLimit: number | null;
  /**
   * Context fill percent (may exceed 100 when input > limit).
   * null when limit is unknown — pie stays empty and label omits percent.
   */
  percent: number | null;
  /** Pie fill clamped to [0, 100] for the solid sector path. */
  fillPercent: number;
  /** Color band for the pie fill. */
  tone: ContextUsageTone;
  /**
   * Compact single-line string for aria-label (screen readers).
   * Visual hover uses {@link tooltip} instead of the native title attribute.
   */
  label: string;
  /** Structured hover bubble (occupancy first, then optional billed usage). */
  tooltip: ContextUsageTooltip;
  /** Whether any occupancy or turn usage has arrived. */
  hasUsage: boolean;
  /**
   * Whether last-turn billed counters are distinct from occupancy-only bags
   * (live `_meta` copies used into input/total with output 0).
   */
  hasTurnUsage: boolean;
};

/**
 * Compact token count for chrome (1.2k / 157.7k / 1.6M).
 * @param n Non-negative token count.
 * @returns Short human string without a unit suffix.
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    const k = n / 1000;
    const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${rounded}k`;
  }
  const m = n / 1_000_000;
  const rounded = m >= 100 ? Math.round(m) : Math.round(m * 10) / 10;
  return `${rounded}M`;
}

/**
 * Format a percent for labels (integer under 10, one decimal otherwise optional).
 * @param percent Raw percent (may exceed 100).
 * @returns e.g. "31%" or "100%+".
 */
export function formatContextPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) {
    return "0%";
  }
  if (percent > 100) {
    return `${Math.round(percent)}%`;
  }
  if (percent < 10) {
    return `${Math.round(percent * 10) / 10}%`;
  }
  return `${Math.round(percent)}%`;
}

/**
 * Map fill percent to a fill tone (ok / warn ≥70 / danger ≥90).
 * @param fillPercent Clamped 0–100, or null when unknown.
 * @param hasUsage Whether any usage exists (idle empty pie when false).
 */
export function contextUsageTone(
  fillPercent: number | null,
  hasUsage: boolean,
): ContextUsageTone {
  if (!hasUsage || fillPercent == null) {
    return "idle";
  }
  if (fillPercent >= 90) {
    return "danger";
  }
  if (fillPercent >= 70) {
    return "warn";
  }
  return "ok";
}

/**
 * SVG pie-sector `d` in a square viewBox, starting at 12 o'clock and sweeping
 * clockwise. A filled path (not a stroke ring) so the composer meter sits at
 * the same visual weight as the weekly chip and model name.
 * @param fillPercent Occupancy 0–100 (already clamped by buildContextUsageDisplay).
 * @param cx Center x in viewBox units.
 * @param cy Center y in viewBox units.
 * @param r Radius in viewBox units; ignored (empty path) when ≤ 0.
 * @returns Path `d`, or "" when there is nothing to paint.
 */
export function contextUsagePiePath(
  fillPercent: number,
  cx: number,
  cy: number,
  r: number,
): string {
  if (!Number.isFinite(fillPercent) || fillPercent <= 0 || r <= 0) {
    return "";
  }
  if (fillPercent >= 100) {
    // Full disk: two 180° arcs — a single 360° arc is invalid in SVG.
    return `M ${fmtPieCoord(cx)} ${fmtPieCoord(cy - r)} A ${fmtPieCoord(r)} ${fmtPieCoord(r)} 0 1 1 ${fmtPieCoord(cx)} ${fmtPieCoord(cy + r)} A ${fmtPieCoord(r)} ${fmtPieCoord(r)} 0 1 1 ${fmtPieCoord(cx)} ${fmtPieCoord(cy - r)} Z`;
  }
  const angle = (fillPercent / 100) * Math.PI * 2;
  const startX = cx;
  const startY = cy - r;
  const endX = cx + r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  const largeArc = fillPercent > 50 ? 1 : 0;
  return `M ${fmtPieCoord(cx)} ${fmtPieCoord(cy)} L ${fmtPieCoord(startX)} ${fmtPieCoord(startY)} A ${fmtPieCoord(r)} ${fmtPieCoord(r)} 0 ${largeArc} 1 ${fmtPieCoord(endX)} ${fmtPieCoord(endY)} Z`;
}

/**
 * Compact path coordinate so 25/50/75% land on exact integers in tests
 * and the SVG `d` stays short. Collapses -0 to 0.
 * @param n ViewBox unit (may be a float from sin/cos).
 */
function fmtPieCoord(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Resolve context limit for the live session model from the agent catalog.
 * @param modelId Current session.model.
 * @param availableModels Agent catalog (may carry totalContextTokens).
 * @returns Positive limit, or null when the model did not declare one.
 */
export function resolveContextLimit(
  modelId: string,
  availableModels: AvailableModel[] | undefined,
): number | null {
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    return null;
  }
  const id = modelId.trim();
  const match =
    (id
      ? availableModels.find((m) => m.id === id || m.name === id)
      : undefined) ?? availableModels[0];
  const limit = match?.totalContextTokens;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }
  return null;
}

/**
 * Merge two model catalogs for the context ring across empty hydrates.
 * Prefer primary structure/order; fill totalContextTokens and reasoningEfforts
 * from secondary when primary rows lost those fields (thin snapshots).
 * @param primary Inbound catalog (structure preferred when non-empty).
 * @param secondary Local/bucket catalog (source of missing window / effort).
 * @returns Merged list, or whichever side is non-empty; undefined if both empty.
 */
export function mergeAvailableModelsPreferContext(
  primary: AvailableModel[] | undefined,
  secondary: AvailableModel[] | undefined,
): AvailableModel[] | undefined {
  if (!primary?.length) {
    return secondary?.length ? secondary : primary;
  }
  if (!secondary?.length) {
    return primary;
  }
  const byId = new Map(secondary.map((m) => [m.id, m]));
  return primary.map((m) => {
    const needsTokens = !(
      typeof m.totalContextTokens === "number" && m.totalContextTokens > 0
    );
    const needsEffort = !m.reasoningEfforts?.length;
    if (!needsTokens && !needsEffort) {
      return m;
    }
    const other = byId.get(m.id);
    if (!other) {
      return m;
    }
    let next = m;
    if (
      needsTokens &&
      typeof other.totalContextTokens === "number" &&
      other.totalContextTokens > 0
    ) {
      next = { ...next, totalContextTokens: other.totalContextTokens };
    }
    if (needsEffort && other.reasoningEfforts?.length) {
      next = { ...next, reasoningEfforts: other.reasoningEfforts };
    }
    return next;
  });
}

/**
 * Whether the composer should mount the context pie.
 * Restore / idle often has a known window (500k) before grok-build answers
 * `session/token_usage`, and `buildContextUsageDisplay` would paint
 * "0 of 500k" — that is "not loaded yet", not an empty conversation.
 * @param usage Session token snapshot; undefined / zero-only → not ready.
 * @returns true when live occupancy or billed-input fallback is > 0.
 */
export function isContextUsageReady(
  usage: SessionTokenUsage | null | undefined,
): boolean {
  const occupied = contextTokensForWindow(usage);
  return occupied != null && occupied > 0;
}

/**
 * True when the snapshot carries a last-turn billed rollup, not just
 * occupancy copied into input/total (live `_meta` / RPC occupancy-only bags).
 * @param usage Session token snapshot; missing / occupancy-only → false.
 */
export function hasBilledTurnUsage(
  usage: SessionTokenUsage | null | undefined,
): boolean {
  if (!usage) {
    return false;
  }
  if (usage.outputTokens > 0) {
    return true;
  }
  if (typeof usage.modelCalls === "number" && usage.modelCalls > 0) {
    return true;
  }
  const occupancy = usage.contextTokensUsed;
  if (
    occupancy !== undefined &&
    usage.inputTokens === occupancy &&
    usage.totalTokens === occupancy
  ) {
    return false;
  }
  return usage.totalTokens > 0;
}

/**
 * Format last-turn billed usage for the hover tip.
 * @param usage Snapshot with billed input / output / total.
 * @returns e.g. "166k tokens (158k in · 8.4k out)".
 */
export function formatTurnUsageLine(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}): string {
  const total = formatTokenCount(usage.totalTokens);
  const input = formatTokenCount(usage.inputTokens);
  const output = formatTokenCount(usage.outputTokens);
  return `${total} tokens (${input} in · ${output} out)`;
}

/**
 * Build the composer meter view-model from session fields.
 * Occupancy drives the pie; last-turn billed counters only appear in the tip.
 * @param usage Live occupancy + last-turn billed rollup, or undefined before first stamp.
 * @param contextLimit Model window size, or null when unknown.
 */
export function buildContextUsageDisplay(
  usage: SessionTokenUsage | null | undefined,
  contextLimit: number | null | undefined,
): ContextUsageDisplay {
  const hasUsage = Boolean(usage);
  const hasTurnUsage = hasBilledTurnUsage(usage);
  const inputTokens = contextTokensForWindow(usage) ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;
  const limit =
    typeof contextLimit === "number" && contextLimit > 0
      ? Math.floor(contextLimit)
      : null;
  const percent = contextUsagePercent(usage ?? null, limit);
  const fillPercent =
    percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const tone = contextUsageTone(percent == null ? null : fillPercent, hasUsage);
  const tooltip = buildContextUsageTooltip({
    hasUsage,
    hasTurnUsage,
    occupancyTokens: inputTokens,
    billedInputTokens: usage?.inputTokens ?? 0,
    billedOutputTokens: outputTokens,
    billedTotalTokens: totalTokens,
    contextLimit: limit,
    percent,
  });
  const label = [
    tooltip.title,
    tooltip.percentLine,
    tooltip.occupancyLine,
    tooltip.usageTitle,
    tooltip.usageLine,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    inputTokens,
    totalTokens,
    outputTokens,
    contextLimit: limit,
    percent,
    fillPercent,
    tone,
    label,
    tooltip,
    hasUsage,
    hasTurnUsage,
  };
}

/**
 * Structured hover tip: occupancy first, then last-turn billed usage.
 * Occupancy lines never say "used N tokens" — that phrase is reserved
 * for the billed-usage section so the two stats stay distinct.
 * When both usage and the window size are missing, occupancyLine is empty
 * so the tip is just "Context window" + "No turns yet" (no long helper).
 * @param parts Occupancy + optional billed snapshot for the current session.
 * @returns Title + occupancy lines + optional usage section for the tip panel.
 */
export function buildContextUsageTooltip(parts: {
  hasUsage: boolean;
  hasTurnUsage: boolean;
  occupancyTokens: number;
  billedInputTokens: number;
  billedOutputTokens: number;
  billedTotalTokens: number;
  contextLimit: number | null;
  percent: number | null;
}): ContextUsageTooltip {
  const title = "Context window";
  const usage = parts.hasTurnUsage
    ? {
        usageTitle: "Last turn usage",
        usageLine: formatTurnUsageLine({
          inputTokens: parts.billedInputTokens,
          outputTokens: parts.billedOutputTokens,
          totalTokens: parts.billedTotalTokens,
        }),
      }
    : {};
  if (!parts.hasUsage) {
    if (parts.contextLimit != null) {
      return {
        title,
        percentLine: "0% occupied (100% remaining)",
        occupancyLine: `0 of ${formatTokenCount(parts.contextLimit)} filled`,
        ...usage,
      };
    }
    return {
      title,
      percentLine: "No turns yet",
      occupancyLine: "",
      ...usage,
    };
  }
  const occupied = formatTokenCount(parts.occupancyTokens);
  if (parts.contextLimit != null && parts.percent != null) {
    const remaining = Math.max(0, 100 - parts.percent);
    return {
      title,
      percentLine: `${formatContextPercent(parts.percent)} occupied (${formatContextPercent(remaining)} remaining)`,
      occupancyLine: `${occupied} of ${formatTokenCount(parts.contextLimit)} filled`,
      ...usage,
    };
  }
  return {
    title,
    percentLine: "Context limit unknown",
    occupancyLine: `${occupied} in context`,
    ...usage,
  };
}
