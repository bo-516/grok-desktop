/**
 * Pure display helpers for the composer context-usage ring.
 * Purpose: format token counts / percent / tooltip from SessionTokenUsage +
 * model totalContextTokens without React or store coupling.
 * Boundary: no I/O; callers supply already-reduced session fields.
 */

import type { AvailableModel, SessionTokenUsage } from "@grok-desktop/acp-core";
import { contextUsagePercent } from "@grok-desktop/acp-core";

/** Severity bands for the ring stroke color. */
export type ContextUsageTone = "idle" | "ok" | "warn" | "danger";

/**
 * Multi-line hover tip for the context ring (Cursor-style bubble).
 * Lines are preformatted; the view only maps them into the tip layout.
 */
export type ContextUsageTooltip = {
  /** First line heading, e.g. "Context window". */
  title: string;
  /** Percent line, e.g. "10% used (90% remaining)". */
  percentLine: string;
  /** Token counts line, e.g. "Used 25k of 258k tokens". */
  tokensLine: string;
};

/** View-model for ComposerContextUsageView. */
export type ContextUsageDisplay = {
  /** Last-turn input tokens (context fill proxy); 0 when no usage yet. */
  inputTokens: number;
  /** Last-turn total tokens (in + out). */
  totalTokens: number;
  /** Last-turn output tokens. */
  outputTokens: number;
  /** Model context window size when known. */
  contextLimit: number | null;
  /**
   * Context fill percent (may exceed 100 when input > limit).
   * null when limit is unknown — ring stays empty and label omits percent.
   */
  percent: number | null;
  /** Ring fill clamped to [0, 100] for stroke-dashoffset. */
  fillPercent: number;
  /** Color band for the ring stroke. */
  tone: ContextUsageTone;
  /**
   * Compact single-line string for aria-label (screen readers).
   * Visual hover uses {@link tooltip} instead of the native title attribute.
   */
  label: string;
  /** Structured hover bubble lines (title + percent + tokens). */
  tooltip: ContextUsageTooltip;
  /** Whether any turn_completed usage has arrived. */
  hasUsage: boolean;
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
 * Map fill percent to a stroke tone (ok / warn ≥70 / danger ≥90).
 * @param fillPercent Clamped 0–100, or null when unknown.
 * @param hasUsage Whether any usage exists (idle empty ring when false).
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
 * Prefer primary structure/order; fill totalContextTokens from secondary when
 * primary rows lost the window size (thin bridge snapshots may strip it).
 * @param primary Inbound catalog (structure preferred when non-empty).
 * @param secondary Local/bucket catalog (source of missing totalContextTokens).
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
    if (
      typeof m.totalContextTokens === "number" &&
      m.totalContextTokens > 0
    ) {
      return m;
    }
    const other = byId.get(m.id);
    if (
      other &&
      typeof other.totalContextTokens === "number" &&
      other.totalContextTokens > 0
    ) {
      return { ...m, totalContextTokens: other.totalContextTokens };
    }
    return m;
  });
}

/**
 * Build the composer ring view-model from session fields.
 * @param usage Last turn_completed usage, or undefined before first turn.
 * @param contextLimit Model window size, or null when unknown.
 */
export function buildContextUsageDisplay(
  usage: SessionTokenUsage | null | undefined,
  contextLimit: number | null | undefined,
): ContextUsageDisplay {
  const hasUsage = Boolean(usage);
  const inputTokens = usage?.inputTokens ?? 0;
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
    inputTokens,
    contextLimit: limit,
    percent,
  });
  const label = [
    tooltip.title,
    tooltip.percentLine,
    tooltip.tokensLine,
  ].join(" · ");
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
  };
}

/**
 * Structured hover tip matching the Cursor-style context bubble.
 * @param parts Token / limit snapshot for the current session.
 * @returns Title + percent line + tokens line for the tip panel.
 */
export function buildContextUsageTooltip(parts: {
  hasUsage: boolean;
  inputTokens: number;
  contextLimit: number | null;
  percent: number | null;
}): ContextUsageTooltip {
  const title = "Context window";
  if (!parts.hasUsage) {
    if (parts.contextLimit != null) {
      return {
        title,
        percentLine: "0% used (100% remaining)",
        tokensLine: `Used 0 of ${formatTokenCount(parts.contextLimit)} tokens`,
      };
    }
    return {
      title,
      percentLine: "No turns yet",
      tokensLine: "Usage updates after the first reply",
    };
  }
  const used = formatTokenCount(parts.inputTokens);
  if (parts.contextLimit != null && parts.percent != null) {
    const remaining = Math.max(0, 100 - parts.percent);
    return {
      title,
      percentLine: `${formatContextPercent(parts.percent)} used (${formatContextPercent(remaining)} remaining)`,
      tokensLine: `Used ${used} of ${formatTokenCount(parts.contextLimit)} tokens`,
    };
  }
  return {
    title,
    percentLine: "Context limit unknown",
    tokensLine: `Used ${used} tokens this turn`,
  };
}
