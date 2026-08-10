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
  if (status === "completed") return "Done";
  if (status === "in_progress") return "In progress";
  if (status === "pending") return "Pending";
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
  if (title) return title;
  const content = entry.content?.trim();
  if (content) return content;
  return `Step ${step}`;
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
