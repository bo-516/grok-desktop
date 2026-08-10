/**
 * Load / derive preview body data for the active PreviewTarget.
 * Keeps PreviewDrawerWidget thin: async file reads and session diffs live here.
 * Turn changesets rebuild turn units from the live session timeline so the
 * drawer does not depend on TimelineView state.
 */

import { useEffect, useMemo, useState } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import {
  buildChangeSetFromToolCalls,
  buildSessionChangeSet,
  buildTurnChangeSet,
  buildTurnChangeSetById,
  type ChangeSet,
} from "@/lib/changeSet";
import { buildFileDiff, type FileDiff } from "@/lib/diffCore";
import {
  normalizeToolContentParts,
  type ToolDiffFragment,
} from "@/lib/toolCardContent";
import type { TurnUnit } from "@/lib/turnGrouping";
import type { PreviewTarget } from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";

/** Discriminated load result for the preview body. */
export type PreviewSource =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "file";
      path: string;
      content: string;
      truncated?: boolean;
      focusLine?: number;
    }
  | {
      status: "diff";
      path: string;
      oldText: string;
      newText: string;
      fileDiff: FileDiff;
      toolCallId: string;
    }
  | { status: "changeset"; changeSet: ChangeSet }
  | { status: "error"; message: string };

/**
 * Resolve the active preview target against session + bridge.
 * @param target Current preview target or null.
 * @param turnByIdOverride Optional map of turnId → TurnUnit (tests); when
 *   omitted, turns are rebuilt from the live session timeline.
 * @returns Load state for the drawer body.
 */
export function usePreviewSource(
  target: PreviewTarget | null,
  turnByIdOverride?: Record<string, TurnUnit | undefined>,
): PreviewSource {
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const timeline = useSessionStore((s) => s.session.timeline);
  const live = useSessionStore((s) => s.live);
  /** Session workspace root; used as default cwd for preview reads. */
  const workspace = useSessionStore((s) => s.session.workspace);
  const [fileState, setFileState] = useState<PreviewSource>({ status: "idle" });

  // File targets: async bridge read.
  useEffect(() => {
    if (!target || target.kind !== "file") {
      setFileState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setFileState({ status: "loading" });
    const path = target.path;
    const readCwd = target.cwd ?? (workspace?.trim() || undefined);
    const run = async () => {
      if (!live?.previewWorkspaceFile) {
        if (!cancelled) {
          setFileState({
            status: "error",
            message: "Bridge not connected — cannot preview file",
          });
        }
        return;
      }
      try {
        const result = await live.previewWorkspaceFile(path, readCwd);
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setFileState({
            status: "error",
            message: previewReasonMessage(result.reason, result.error),
          });
          return;
        }
        setFileState({
          status: "file",
          path,
          content: result.content ?? "",
          truncated: result.truncated,
          focusLine: target.line,
        });
      } catch (e) {
        if (!cancelled) {
          setFileState({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [target, live, workspace]);

  // Diff + changeset are pure over session data.
  return useMemo(() => {
    if (!target) {
      return { status: "idle" };
    }
    if (target.kind === "file") {
      return fileState;
    }
    if (target.kind === "diff") {
      return resolveDiffSource(target, toolCalls);
    }
    if (target.kind === "changeset" && target.scope === "session") {
      return {
        status: "changeset",
        changeSet: buildSessionChangeSet(toolCalls),
      };
    }
    if (target.kind === "changeset" && target.scope === "turn") {
      // Prefer toolCallIds captured when the turn summary was clicked.
      if (target.toolCallIds && target.toolCallIds.length > 0) {
        return {
          status: "changeset",
          changeSet: buildChangeSetFromToolCalls(toolCalls, target.toolCallIds),
        };
      }
      const changeSet = turnByIdOverride
        ? (() => {
            const unit = turnByIdOverride[target.turnId];
            return unit ? buildTurnChangeSet(unit, toolCalls) : null;
          })()
        : buildTurnChangeSetById(target.turnId, timeline, toolCalls);
      if (!changeSet) {
        return {
          status: "error",
          message: "Turn not found for change set",
        };
      }
      return { status: "changeset", changeSet };
    }
    return { status: "idle" };
  }, [target, fileState, toolCalls, turnByIdOverride, timeline]);
}

/**
 * Pull old/new text for a tool-call + path and build a FileDiff.
 * @param target Diff preview target.
 * @param toolCalls Session tool-call map.
 */
function resolveDiffSource(
  target: Extract<PreviewTarget, { kind: "diff" }>,
  toolCalls: Record<string, ToolCallCard | undefined>,
): PreviewSource {
  const card = toolCalls[target.toolCallId];
  if (!card) {
    return { status: "error", message: "Tool call not found" };
  }
  const parts = normalizeToolContentParts(card.content);
  const match = parts.find((p) => {
    if (p.type !== "diff") {
      return false;
    }
    const frag = p as ToolDiffFragment;
    return (frag.path ?? "(unknown)") === target.path;
  }) as ToolDiffFragment | undefined;
  if (!match) {
    return {
      status: "error",
      message: `No diff data for ${target.path}`,
    };
  }
  const oldText = match.oldText ?? "";
  const newText = match.newText ?? "";
  const fileDiff = buildFileDiff(oldText, newText);
  return {
    status: "diff",
    path: target.path,
    oldText,
    newText,
    fileDiff,
    toolCallId: target.toolCallId,
  };
}

/**
 * Human-readable error for a failed preview read reason.
 * @param reason Bridge reason code.
 * @param error Optional free-form error.
 */
function previewReasonMessage(
  reason: string | undefined,
  error: string | undefined,
): string {
  if (reason === "sensitive") {
    return "This file looks sensitive and cannot be previewed.";
  }
  if (reason === "binary") {
    return "Binary files cannot be previewed as text.";
  }
  if (reason === "directory") {
    return "That path is a directory, not a file.";
  }
  if (reason === "outside") {
    return "Path is outside the workspace.";
  }
  if (reason === "not_found") {
    return "File not found.";
  }
  return error ?? reason ?? "Failed to load file";
}
