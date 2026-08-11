/**
 * Native per-hunk accept/reject review (F-NATIVE-06).
 * Lives in the preview drawer (not the timeline stream) so write controls
 * are not mixed into the scrolling message list.
 */

import cs from "classnames";
import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../../store/sessionStore";
import {
  applyHunkDecisions,
  createDiffReview,
  setHunkDecision,
  type ReviewableHunk,
} from "../../lib/diffHunkApply";
import { languageForPath } from "../../lib/codeHighlightLanguages";
import { diffRowTokens } from "../../lib/diffLineTokens";
import { CodeLineView, useCodeHighlight } from "../shared";

export type DiffReviewViewProps = {
  path: string;
  oldText?: string;
  newText?: string;
};

/**
 * Interactive hunk list for one file diff; Apply writes merged content under workspace.
 * Resets hunk decisions whenever path/old/new change so switching targets
 * cannot leave stale accept/reject state (parent should also key remount).
 * @param props Path + old/new texts from a tool-call diff fragment.
 */
export function DiffReviewView(props: DiffReviewViewProps) {
  const live = useSessionStore((s) => s.live);
  /** Canvas session workspace — required so Apply does not hit the last-started pool cwd. */
  const workspace = useSessionStore((s) => s.session.workspace);
  const initial = useMemo(
    () => createDiffReview(props.oldText, props.newText),
    [props.oldText, props.newText],
  );
  const [hunks, setHunks] = useState<ReviewableHunk[]>(initial.hunks);
  const [status, setStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  /*
   * Highlight both sides whole, then index per row — hunk lines alone lack the
   * surrounding context TextMate needs. Accept/reject only changes what is
   * written on Apply, never the rendered text, so decisions do not invalidate
   * these tokens.
   */
  const language = useMemo(() => languageForPath(props.path), [props.path]);
  const oldLines = useCodeHighlight(props.oldText ?? "", language);
  const newLines = useCodeHighlight(props.newText ?? "", language);

  // Sync when the preview target / texts change without a full remount.
  useEffect(() => {
    setHunks(initial.hunks);
    setStatus(null);
    setApplying(false);
  }, [initial, props.path]);

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
      const writeCwd = workspace?.trim() || undefined;
      const result = await live.writeWorkspaceFile(
        props.path,
        content,
        writeCwd,
      );
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
          {h.lines.map((line) => (
            <div
              key={`${h.id}:${line.type}:${String(line.lineNo ?? "")}:${line.text}`}
              className={cs("diff-line", {
                "diff-line-add": line.type === "add",
                "diff-line-del": line.type === "del",
              })}
            >
              <span className="diff-gutter">{diffGutterMark(line.type)}</span>
              <span className="diff-text">
                <CodeLineView
                  text={line.text}
                  tokens={diffRowTokens(
                    line,
                    oldLines ?? undefined,
                    newLines ?? undefined,
                  )}
                />
              </span>
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

/**
 * Gutter character for a unified-diff style line.
 * @param type Line kind from buildLineDiff.
 */
function diffGutterMark(type: "same" | "add" | "del"): string {
  if (type === "add") {
    return "+";
  }
  if (type === "del") {
    return "-";
  }
  return " ";
}
