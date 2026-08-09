/**
 * Plan panel + approval actions (F-PLAN-01/04).
 * Auto / always-approve never skip plan approval (upstream contract).
 */

import cs from "classnames";
import type { PlanEntry } from "@grok-desktop/acp-core";
import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";

type PlanPanelViewProps = {
  entries: PlanEntry[] | undefined;
  /** When true, show approve / revise / comment / exit controls. */
  showApproval?: boolean;
};

/**
 * Plan list with status chips and optional approval bar.
 * @param props Plan entries from session.plan; approval sends slash prompts.
 */
export function PlanPanelView(props: PlanPanelViewProps) {
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const [comment, setComment] = useState("");
  const entries = props.entries ?? [];
  const showApproval = props.showApproval !== false && entries.length > 0;

  if (entries.length === 0) {
    return (
      <div className="plan-empty">
        No plan yet. Ask for an architecture plan or use /plan.
      </div>
    );
  }

  return (
    <div className="plan-panel" data-kind="plan">
      <ol className="plan-list">
        {entries.map((entry, step) => {
          const status = entry.status ?? "pending";
          const label = entry.title || entry.content || `Step ${step + 1}`;
          return (
            <li
              key={`${status}|${label}|${entry.content ?? ""}`}
              className={cs("plan-item", {
                "plan-item-done": status === "completed",
                "plan-item-active": status === "in_progress",
              })}
            >
              <span className={cs("plan-status", `plan-status-${status}`)}>
                {status}
              </span>
              <span className="plan-text">{label}</span>
            </li>
          );
        })}
      </ol>
      {showApproval ? (
        <div className="plan-approval" role="group" aria-label="Plan approval">
          <p className="plan-approval-hint">
            Plan approval is required even in auto / always-approve modes.
          </p>
          <div className="plan-approval-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void sendPrompt("Approve the plan and execute it.")}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                void sendPrompt(
                  "Please revise the plan based on my feedback before executing.",
                )
              }
            >
              Request changes
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void sendPrompt("/plan")}
            >
              Exit plan mode
            </button>
          </div>
          <div className="plan-comment-row">
            <input
              className="text-input"
              placeholder="Inline comment on the plan…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost"
              disabled={!comment.trim()}
              onClick={() => {
                const text = comment.trim();
                setComment("");
                void sendPrompt(`Plan comment: ${text}`);
              }}
            >
              Comment
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
