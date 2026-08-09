/**
 * Native per-hunk accept/reject review (F-NATIVE-06).
 * Applies resulting file text through live bridge write_workspace_file.
 */

import cs from "classnames";
import { useMemo, useState } from "react";
import { useSessionStore } from "../../store/sessionStore";
import {
  applyHunkDecisions,
  createDiffReview,
  setHunkDecision,
  type ReviewableHunk,
} from "../../lib/diffHunkApply";

export type DiffReviewViewProps = {
  path: string;
  oldText?: string;
  newText?: string;
};

/**
 * Interactive hunk list for one file diff; Apply writes merged content under workspace.
 */
export function DiffReviewView(props: DiffReviewViewProps) {
  const live = useSessionStore((s) => s.live);
  const initial = useMemo(
    () => createDiffReview(props.oldText, props.newText),
    [props.oldText, props.newText],
  );
  const [hunks, setHunks] = useState<ReviewableHunk[]>(initial.hunks);
  const [status, setStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const decide = (id: string, decision: "accept" | "reject") => {
    setHunks((prev) => setHunkDecision(prev, id, decision));
  };

  const apply = async () => {
    if (!live?.writeWorkspaceFile) {
      setStatus("Bridge not connected — cannot apply");
      return;
    }
    setApplying(true);
    setStatus(null);
    try {
      const content = applyHunkDecisions(props.oldText, props.newText, hunks);
      const result = await live.writeWorkspaceFile(props.path, content);
      if (!result.ok) {
        setStatus(result.error ?? "write failed");
      } else {
        setStatus(`Applied to ${props.path}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  if (hunks.length === 0) {
    return (
      <div className="diff-review" data-kind="diff-review">
        <div className="mini-diff-path">{props.path} · no changes</div>
      </div>
    );
  }

  return (
    <div className="diff-review" data-kind="diff-review">
      <div className="mini-diff-path">
        {props.path}{" "}
        <span className="mini-diff-summary">{initial.summary}</span>
      </div>
      {hunks.map((h) => (
        <div
          key={h.id}
          className={cs("diff-hunk", {
            "diff-hunk-accept": h.decision === "accept",
            "diff-hunk-reject": h.decision === "reject",
          })}
        >
          <div className="diff-hunk-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => decide(h.id, "accept")}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => decide(h.id, "reject")}
            >
              Reject
            </button>
            <span className="palette-kind">{h.decision}</span>
          </div>
          {h.lines.map((line, li) => (
            <div
              key={`${h.id}-${li}`}
              className={cs("diff-line", {
                "diff-line-add": line.type === "add",
                "diff-line-del": line.type === "del",
              })}
            >
              <span className="diff-gutter">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              <span className="diff-text">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="diff-review-footer">
        <button
          type="button"
          className="btn-primary"
          disabled={applying}
          onClick={() => void apply()}
        >
          {applying ? "Applying…" : "Apply decisions to disk"}
        </button>
        {status ? <span className="side-panel-hint">{status}</span> : null}
      </div>
    </div>
  );
}
