/**
 * Right-rail plan panel — whole-replaced from plan session updates.
 * Stateless presentation over session.plan.
 */

import { useSessionStore } from "../store/sessionStore";

/**
 * Display mark for a plan step status.
 * @param status Step status; unknown or missing values fall back to an empty circle.
 */
function planStatusMark(status: string | undefined): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "in_progress") {
    return "●";
  }
  return "○";
}

export function PlanPanelView() {
  const plan = useSessionStore((s) => s.session.plan);

  return (
    <div>
      <div className="rail-head">Plan</div>
      {!plan || plan.length === 0 ? (
        <div className="plan-empty">No plan yet</div>
      ) : (
        plan.map((step, i) => {
          const label = step.content ?? step.title ?? `Step ${i + 1}`;
          return (
            <div className="plan-step" key={label}>
              <span aria-hidden="true">{planStatusMark(step.status)}</span>
              <span>{label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
