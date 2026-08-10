/**
 * Plan panel — display-only checklist (F-PLAN-01).
 * Empty state, progress header, and status markers only.
 * Approving / revising / leaving plan mode belongs in the composer, not here.
 */

import cs from "classnames";
import type { PlanEntry } from "@grok-desktop/acp-core";
import { Check, ListTodo } from "lucide-react";
import { useMemo } from "react";
import {
  planEntryLabel,
  planProgress,
  planStatusLabel,
} from "../lib/planPanel";

type PlanPanelViewProps = {
  /** Plan entries from session.plan; empty shows empty state. */
  entries: PlanEntry[] | undefined;
};

/**
 * Stateless plan list with progress and status markers (no store, no prompts).
 * @param props Plan entries from session.plan.
 * @returns Empty state, or progress header + checklist when entries exist.
 */
export function PlanPanelView(props: PlanPanelViewProps) {
  const entries = props.entries ?? [];
  const { done, total } = useMemo(() => planProgress(entries), [entries]);
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  if (entries.length === 0) {
    return (
      <div className="plan-empty">
        <ListTodo size={18} strokeWidth={1.75} aria-hidden="true" />
        <p className="plan-empty-title">No plan yet</p>
        <p className="plan-empty-hint">
          Ask for an architecture plan or use{" "}
          <kbd className="banner-code">/plan</kbd>.
        </p>
      </div>
    );
  }

  return (
    <div className="plan-panel" data-kind="plan">
      <div className="plan-progress" aria-label="Plan progress">
        <div className="plan-progress-meta">
          <span>Progress</span>
          <span className="plan-progress-count">
            {done}/{total}
          </span>
        </div>
        <div
          className="plan-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          aria-valuetext={`${done} of ${total} steps complete`}
        >
          <div
            className="plan-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="plan-list-scroll">
        <ol className="plan-list">
          {entries.map((entry, index) => {
            const status = entry.status ?? "pending";
            const step = index + 1;
            const label = planEntryLabel(entry, step);
            const isDone = status === "completed";
            const isActive = status === "in_progress";
            return (
              <li
                key={`${status}|${label}|${entry.content ?? ""}|${index}`}
                className={cs("plan-item", {
                  "plan-item-done": isDone,
                  "plan-item-active": isActive,
                })}
              >
                <span
                  className={cs("plan-marker", {
                    "plan-marker-done": isDone,
                    "plan-marker-active": isActive,
                    "plan-marker-pending": !isDone && !isActive,
                  })}
                  aria-hidden="true"
                >
                  {isDone ? <Check size={12} strokeWidth={2.5} /> : step}
                </span>
                <div className="plan-item-body">
                  <span
                    className={cs("plan-status-label", {
                      "plan-status-label-done": isDone,
                      "plan-status-label-active": isActive,
                    })}
                  >
                    {planStatusLabel(status)}
                  </span>
                  <span
                    className={cs("plan-text", {
                      "plan-text-done": isDone,
                      "plan-text-active": isActive,
                    })}
                  >
                    {label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
