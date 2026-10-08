/**
 * Entry hook for "Restore files to before this turn". Flow: open → read the
 * session's grok-build rewind points and map the turn onto one (loading) →
 * confirm dialog listing the files from the timeline (nothing written yet) →
 * `rewind_files` without force → done, or a conflicts step when files changed
 * outside the agent → explicit "overwrite" retries with force. The restore
 * itself is grok-build's (files_only); see apps/bridge-go/internal/rewind.
 */

import { useCallback, useRef, useState } from "react";
import {
  hasSnapshotsFrom,
  matchRewindPoint,
  promptAnchorsForTimeline,
  rewindFilePlan,
  type RewindFilePlan,
} from "@/lib/turnRewind";
import { fetchRewindPoints, runRewindFiles, type RewindResult } from "@/lib/turnRewindBridge";
import { liveGitRunner, useGitStore } from "@/store/gitStore";
import { useSessionStore } from "@/store/sessionStore";

/** Dialog phase; "closed" renders no dialog. */
export type TurnRewindPhase = "closed" | "loading" | "confirm" | "conflicts" | "working" | "done" | "error";

/** Model returned by {@link useTurnRewindWidget}. */
export type TurnRewindModel = {
  /** Current phase. */
  phase: TurnRewindPhase;
  /** Files the timeline says the restore touches (this turn and later). */
  plan: RewindFilePlan;
  /** Last rewind_files reply (conflicts / done), or null. */
  result: RewindResult | null;
  /** Error text for the error phase ("" otherwise). */
  error: string;
  /** Why the trigger is disabled ("" when enabled). */
  disabledReason: string;
  /** Start the flow (no-op while disabled). */
  open: () => void;
  /** Restore without overwriting outside edits. */
  confirm: () => void;
  /** Restore and overwrite files changed outside the agent. */
  force: () => void;
  /** Close the dialog (a request in flight is ignored when it lands). */
  close: () => void;
};

/** Empty plan before the dialog opens. */
const EMPTY_PLAN: RewindFilePlan = { files: [], laterTurns: 0 };

/**
 * Error text from a rejection.
 * @param e Unknown rejection.
 * @returns Message.
 */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Why the restore trigger is disabled.
 * @param sessionId Current session id ("" on a New chat draft).
 * @param busy True while a turn streams or waits on a permission.
 * @returns Reason text, or "" when the restore can start.
 */
export function disabledReasonFor(sessionId: string, busy: boolean): string {
  if (!sessionId) {
    return "Start the chat before restoring files";
  }
  return busy ? "Wait for the current turn to finish" : "";
}

/**
 * Restore-files flow for one turn of the current session.
 * @param turnId TurnUnit.id of the turn to restore to (its start).
 * @returns Phase, data and handlers for TurnRewindDialogView.
 */
export function useTurnRewindWidget(turnId: string): TurnRewindModel {
  const sessionId = useSessionStore((s) => s.session.id);
  const cwd = useSessionStore((s) => s.session.workspace) ?? "";
  const status = useSessionStore((s) => s.session.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const [phase, setPhase] = useState<TurnRewindPhase>("closed");
  const [plan, setPlan] = useState<RewindFilePlan>(EMPTY_PLAN);
  const [target, setTarget] = useState(-1);
  const [result, setResult] = useState<RewindResult | null>(null);
  const [error, setError] = useState("");
  /** Bumped on open / close so late replies of an abandoned request are dropped. */
  const requestRef = useRef(0);
  const disabledReason = disabledReasonFor(sessionId, status === "streaming" || status === "waiting_permission");

  /**
   * Fail into the error phase.
   * @param text Message to show.
   */
  const fail = useCallback((text: string) => {
    setError(text);
    setPhase("error");
  }, []);

  const open = useCallback(() => {
    if (disabledReason) {
      return;
    }
    const { timeline, toolCalls } = useSessionStore.getState().session;
    const anchors = promptAnchorsForTimeline(timeline, toolCalls);
    const req = requestRef.current + 1;
    requestRef.current = req;
    setPlan(rewindFilePlan(timeline, toolCalls, turnId, cwd));
    setResult(null);
    setError("");
    setPhase("loading");
    fetchRewindPoints(liveGitRunner(), cwd, sessionId).then(
      (points) => {
        if (requestRef.current !== req) {
          return;
        }
        const match = matchRewindPoint(anchors, turnId, points);
        if (!match.ok) {
          fail(match.reason);
          return;
        }
        if (!hasSnapshotsFrom(points, match.point.promptIndex)) {
          fail(
            "grok-build has no recorded file edits from this turn on. They may already have been restored, or were made by shell commands it does not track.",
          );
          return;
        }
        setTarget(match.point.promptIndex);
        setPhase("confirm");
      },
      (e: unknown) => {
        if (requestRef.current === req) {
          fail(messageOf(e));
        }
      },
    );
  }, [disabledReason, turnId, cwd, sessionId, fail]);

  /**
   * Call rewind_files.
   * @param force Overwrite files changed outside the agent.
   */
  const run = useCallback(
    (force: boolean) => {
      const req = requestRef.current + 1;
      requestRef.current = req;
      setPhase("working");
      runRewindFiles(liveGitRunner(), cwd, { sessionId, targetPromptIndex: target, force }).then(
        (res) => {
          if (requestRef.current !== req) {
            return;
          }
          setResult(res);
          if (res.success) {
            setPhase("done");
            void refreshStatus(cwd);
          } else if (!force && res.conflicts.length > 0) {
            setPhase("conflicts");
          } else {
            fail(res.error);
          }
        },
        (e: unknown) => {
          if (requestRef.current === req) {
            fail(messageOf(e));
          }
        },
      );
    },
    [cwd, sessionId, target, refreshStatus, fail],
  );

  const confirm = useCallback(() => run(false), [run]);
  const force = useCallback(() => run(true), [run]);
  const close = useCallback(() => {
    requestRef.current += 1;
    setPhase("closed");
  }, []);

  return { phase, plan, result, error, disabledReason, open, confirm, force, close };
}
