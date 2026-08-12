/**
 * Stateful single-paint diff review shell (F-NATIVE-06).
 * Owns hunk decisions + Apply write; paints the structured diff once via
 * PreviewDiffWidget(review=…). Does not render its own diff rows.
 * Apply is gated by whole-file safety (disk === newText) so window fragments
 * cannot truncate the on-disk file.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyHunkDecisions,
  createDiffReview,
  setHunkDecision,
  type HunkDecision,
  type ReviewableHunk,
} from "@/lib/diffHunkApply";
import { canApplyWholeFile } from "@/lib/diffFullFile";
import { useSessionStore } from "@/store/sessionStore";
import { PreviewDiffWidget } from "./PreviewDiffWidget";
import {
  fullFileBannerText,
  useDiffFullFile,
} from "./useDiffFullFile";

export type DiffReviewWidgetProps = {
  /** Workspace-relative or absolute path written on Apply. */
  path: string;
  /** Pre-edit content (ACP fragment until full-file align). */
  oldText?: string;
  /** Agent-proposed content (ACP fragment until full-file align). */
  newText?: string;
  /**
   * When true, multi-fragment merge is untrustworthy — force unavailable and
   * keep Apply disabled.
   */
  forceUnavailable?: boolean;
};

/** @deprecated Prefer DiffReviewWidget; kept as a type alias for call sites. */
export type DiffReviewViewProps = DiffReviewWidgetProps;

/**
 * Interactive review for one file: decisions + Apply, one painted diff body.
 * Resets decisions when path/old/new change so switching targets cannot leave
 * stale accept/reject state (parent should also key remount).
 * @param props Path + old/new texts from a tool-call diff fragment.
 */
export function DiffReviewWidget(props: DiffReviewWidgetProps) {
  const live = useSessionStore((s) => s.live);
  /** Canvas session workspace — required so Apply does not hit the last-started pool cwd. */
  const workspace = useSessionStore((s) => s.session.workspace);
  const fragOld = props.oldText ?? "";
  const fragNew = props.newText ?? "";

  const {
    oldText,
    newText,
    fileDiff,
    fullFile,
    ensureFullFile,
    applyGate,
    relativeLineNumbers,
  } = useDiffFullFile({
    path: props.path,
    fragOld,
    fragNew,
    forceUnavailable: props.forceUnavailable,
  });

  const initial = useMemo(
    () => createDiffReview(oldText, newText),
    [oldText, newText],
  );
  const [hunks, setHunks] = useState<ReviewableHunk[]>(initial.hunks);
  const [status, setStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Sync when the preview target / texts change without a full remount.
  useEffect(() => {
    setHunks(initial.hunks);
    setStatus(null);
    setApplying(false);
  }, [initial, props.path]);

  const decisionByIndex = useMemo(() => {
    const map: Record<number, HunkDecision> = {};
    for (let i = 0; i < hunks.length; i += 1) {
      const hunk = hunks[i];
      if (hunk) {
        map[i] = hunk.decision;
      }
    }
    return map;
  }, [hunks]);

  const onDecide = useCallback((index: number, decision: "accept" | "reject") => {
    setHunks((prev) => {
      const target = prev[index];
      if (!target) {
        return prev;
      }
      return setHunkDecision(prev, target.id, decision);
    });
  }, []);

  const apply = async () => {
    if (!live?.writeWorkspaceFile) {
      setStatus("Bridge not connected — cannot apply");
      return;
    }
    setApplying(true);
    setStatus(null);
    try {
      // Reconstruct first so Apply writes the full file, not a window fragment.
      const aligned = await ensureFullFile();
      if (
        aligned.fullFile.state === "unavailable" ||
        aligned.fullFile.state === "idle" ||
        aligned.fullFile.state === "loading"
      ) {
        setStatus(applyGate.reason ?? "无法与磁盘对齐，已停用写回");
        return;
      }
      const diskText = aligned.diskText;
      if (diskText == null) {
        setStatus("无法校验文件完整性，已停用写回");
        return;
      }
      /*
       * Safety: pre-decision newText must equal disk (whole-file align).
       * After decisions, content may differ (rejected hunks keep old) — that is OK.
       */
      if (!canApplyWholeFile(diskText, aligned.newText)) {
        setStatus("此 diff 只覆盖文件的一部分，写回会截断文件");
        return;
      }
      /*
       * Rebuild hunk list from aligned texts (state may still hold fragment hunks
       * for one frame after reconstruct). Transfer accept/reject by index when
       * counts match; otherwise leave pending (full newText wins for unset).
       */
      const fresh = createDiffReview(aligned.oldText, aligned.newText);
      let reviewHunks = fresh.hunks;
      if (reviewHunks.length === hunks.length) {
        for (let i = 0; i < reviewHunks.length; i += 1) {
          const prior = hunks[i];
          if (prior && prior.decision !== "pending") {
            reviewHunks = setHunkDecision(
              reviewHunks,
              reviewHunks[i]!.id,
              prior.decision,
            );
          }
        }
      }
      const content = applyHunkDecisions(
        aligned.oldText,
        aligned.newText,
        reviewHunks,
      );
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

  /*
   * Idle/loading: allow the click so apply() can ensureFullFile first.
   * After settle: require canApply (whole/window only). Unavailable stays off.
   */
  const applyDisabled =
    applying ||
    applyGate.checking ||
    fullFile.state === "unavailable" ||
    (fullFile.state !== "idle" &&
      fullFile.state !== "loading" &&
      !applyGate.canApply);
  const banner = fullFileBannerText(fullFile);
  const footerHint =
    fullFile.state === "idle" || fullFile.state === "loading"
      ? null
      : !applyGate.canApply
        ? applyGate.reason
        : null;

  if (hunks.length === 0) {
    return (
      <div className="diff-review" data-kind="diff-review">
        <div className="preview-empty">
          {props.path} · no changes
        </div>
      </div>
    );
  }

  return (
    <div className="diff-review" data-kind="diff-review">
      <PreviewDiffWidget
        fileDiff={fileDiff}
        path={props.path}
        oldText={oldText}
        newText={newText}
        /* Drawer head already shows the path + +N/−M; avoid a second path row. */
        showPath={false}
        review={{ decisionByIndex, onDecide }}
        onRequestFullFile={() => {
          void ensureFullFile();
        }}
        relativeLineNumbers={relativeLineNumbers}
        banner={banner}
      />
      <div className="diff-review-footer">
        <button
          type="button"
          className="btn-primary"
          disabled={applyDisabled}
          title={applyGate.reason ?? undefined}
          onClick={() => void apply()}
        >
          {applying ? "Applying…" : "Apply decisions to disk"}
        </button>
        <span className="mini-diff-summary">{initial.summary}</span>
        {footerHint ? (
          <span className="side-panel-hint" role="status">
            {footerHint}
          </span>
        ) : null}
        {status ? <span className="side-panel-hint">{status}</span> : null}
      </div>
    </div>
  );
}

/**
 * Back-compat export name used by older imports / surface contracts mid-rename.
 * Prefer DiffReviewWidget for new call sites.
 */
export const DiffReviewView = DiffReviewWidget;
