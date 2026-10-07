/**
 * Pure helpers for the plan companion drawer panel.
 * Keeps PlanPanelView free of formatting / progress math.
 */

import type { PlanEntry } from "@grok-desktop/acp-core";

/** Normalized plan step status from the agent (or any string it sends). */
export type PlanStatus = "pending" | "in_progress" | "completed" | string;

/**
 * Human label for a plan entry status.
 * @param status Raw status from the agent (pending / in_progress / completed / …).
 * @returns Short display string; unknown values pass through with underscores spaced.
 */
export function planStatusLabel(status: PlanStatus): string {
  if (status === "completed") {
    return "Done";
  }
  if (status === "in_progress") {
    return "In progress";
  }
  if (status === "pending") {
    return "Pending";
  }
  return String(status).replace(/_/g, " ");
}

/**
 * Step title: prefer title, then content; never leave blank.
 * @param entry Plan entry from session update.
 * @param step 1-based index used only when both title and content are missing.
 * @returns Non-empty label for the step row.
 */
export function planEntryLabel(entry: PlanEntry, step: number): string {
  const title = entry.title?.trim();
  if (title) {
    return title;
  }
  const content = entry.content?.trim();
  if (content) {
    return content;
  }
  return `Step ${step}`;
}

/** One renderable plan step with a stable, content-derived React key. */
export type PlanRow = {
  /**
   * Unique within the list: `status|label|content`, suffixed `#n` (first free
   * n ≥ 1) when that string is already taken so duplicate steps never collide.
   */
  key: string;
  /** Source entry from session.plan. */
  entry: PlanEntry;
  /** 1-based position shown in the marker. */
  step: number;
  /** Entry status with missing values treated as "pending". */
  status: PlanStatus;
  /** Display label from {@link planEntryLabel}. */
  label: string;
};

/**
 * Pick the first key not yet in `used`: `base`, then `base#1`, `base#2`, …
 * Pure apart from the caller-owned `used` set, which it does not mutate.
 * @param base Preferred key derived from row content.
 * @param used Keys already assigned to earlier rows.
 * @returns A key guaranteed absent from `used`.
 */
function firstFreeKey(base: string, used: ReadonlySet<string>): string {
  let candidate = base;
  let n = 1;
  while (used.has(candidate)) {
    candidate = `${base}#${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Derive display rows (status, label, step, key) for the plan checklist.
 * Keys come from row content rather than the array index; a repeated key gets
 * an occurrence suffix so keys stay unique even for identical steps.
 * @param entries Plan list in agent order (may be empty).
 * @returns One row per entry, same order and length as `entries`.
 */
export function planRows(entries: PlanEntry[]): PlanRow[] {
  const used = new Set<string>();
  return entries.map((entry, index) => {
    const step = index + 1;
    const status = entry.status ?? "pending";
    const label = planEntryLabel(entry, step);
    const key = firstFreeKey(`${status}|${label}|${entry.content ?? ""}`, used);
    used.add(key);
    return { key, entry, step, status, label };
  });
}

/**
 * Count completed steps for the progress bar.
 * @param entries Plan list (may be empty).
 * @returns completed count and total length.
 */
export function planProgress(entries: PlanEntry[]): {
  done: number;
  total: number;
} {
  const total = entries.length;
  const done = entries.filter((e) => (e.status ?? "pending") === "completed")
    .length;
  return { done, total };
}
