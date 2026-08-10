/**
 * Aggregate ACP tool-call diff fragments into per-path change sets (S1).
 * Answers "what did the agent change this turn/session" — not git vs HEAD.
 * Pure: no store, no bridge, no DOM.
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { buildFileDiff } from "./diffCore";
import { buildTimelineRenderUnits } from "./timelinePipeline";
import {
  normalizeLocations,
  normalizeToolContentParts,
} from "./toolCardContent";
import type { TurnUnit } from "./turnGrouping";

/** Status of one path after folding every diff fragment for that path. */
export type ChangeSetFileStatus =
  | "ok"
  | "failed"
  | "no_baseline"
  | "no_diff_data";

/** One path in a turn/session change set. */
export type ChangeSetFile = {
  path: string;
  /** First non-empty oldText for this path ("" for new files). */
  baseText: string;
  /** Last newText for this path. */
  headText: string;
  added: number;
  removed: number;
  toolCallIds: string[];
  status: ChangeSetFileStatus;
  /** True when the line-diff engine degraded (size / maxEditLength). */
  degraded?: boolean;
};

/** Aggregated change set for a turn or whole session. */
export type ChangeSet = {
  files: ChangeSetFile[];
  /** Distinct paths with any recorded edit. */
  fileCount: number;
  added: number;
  removed: number;
};

/** Diff fragment with required path + owning toolCallId. */
export type OrderedDiffFragment = {
  path: string;
  oldText?: string;
  newText?: string;
  toolCallId: string;
  failed: boolean;
};

/**
 * Extract ordered diff fragments from a tool-call map entry.
 * @param toolCallId Card id.
 * @param card Card body (may be missing).
 * @returns Fragments in content order; empty when no diffs.
 */
export function extractDiffFragmentsFromCard(
  toolCallId: string,
  card: ToolCallCard | undefined,
): OrderedDiffFragment[] {
  if (!card) {
    return [];
  }
  const parts = normalizeToolContentParts(card.content);
  const failed = card.status === "failed";
  const out: OrderedDiffFragment[] = [];
  for (const part of parts) {
    if (part.type !== "diff") {
      continue;
    }
    const path =
      typeof part.path === "string" && part.path ? part.path : "(unknown)";
    out.push({
      path,
      oldText: typeof part.oldText === "string" ? part.oldText : undefined,
      newText: typeof part.newText === "string" ? part.newText : undefined,
      toolCallId,
      failed,
    });
  }
  return out;
}

/**
 * Collect edit paths that have no diff content (shell edits etc.).
 * @param toolCallId Card id.
 * @param card Card body.
 * @returns Paths from locations/title when kind is edit and no diffs.
 */
export function extractNoDiffEditPaths(
  toolCallId: string,
  card: ToolCallCard | undefined,
): Array<{ path: string; toolCallId: string; failed: boolean }> {
  if (!card || card.kind !== "edit") {
    return [];
  }
  const diffs = extractDiffFragmentsFromCard(toolCallId, card);
  if (diffs.length > 0) {
    return [];
  }
  const failed = card.status === "failed";
  const paths = normalizeLocations(card.rawLocations);
  if (paths.length === 0 && typeof card.title === "string" && card.title) {
    paths.push(card.title);
  }
  return paths.map((path) => ({ path, toolCallId, failed }));
}

/**
 * Fold ordered tool-call events into per-path base/head + line counts.
 * @param toolCalls Session tool-call map (id → card).
 * @param orderedIds Tool-call ids in timeline order; when omitted, Object.keys order.
 * @returns Change set with aggregate +/−.
 */
export function buildChangeSetFromToolCalls(
  toolCalls: Record<string, ToolCallCard | undefined>,
  orderedIds?: string[],
): ChangeSet {
  const ids = orderedIds ?? Object.keys(toolCalls);
  type Acc = {
    path: string;
    baseText: string;
    headText: string;
    hasOld: boolean;
    hasNew: boolean;
    toolCallIds: string[];
    anyFailed: boolean;
    noDiffData: boolean;
  };
  const byPath = new Map<string, Acc>();

  for (const id of ids) {
    const card = toolCalls[id];
    const frags = extractDiffFragmentsFromCard(id, card);
    for (const frag of frags) {
      const existing = byPath.get(frag.path);
      const acc: Acc =
        existing ??
        {
          path: frag.path,
          baseText: "",
          headText: "",
          hasOld: false,
          hasNew: false,
          toolCallIds: [],
          anyFailed: false,
          noDiffData: false,
        };
      if (!existing) {
        byPath.set(frag.path, acc);
      }
      if (!acc.toolCallIds.includes(frag.toolCallId)) {
        acc.toolCallIds.push(frag.toolCallId);
      }
      if (frag.failed) {
        acc.anyFailed = true;
      }
      if (frag.oldText !== undefined && !acc.hasOld) {
        acc.baseText = frag.oldText;
        acc.hasOld = true;
      }
      if (frag.newText !== undefined) {
        acc.headText = frag.newText;
        acc.hasNew = true;
      }
    }
    for (const bare of extractNoDiffEditPaths(id, card)) {
      const existing = byPath.get(bare.path);
      const acc: Acc =
        existing ??
        {
          path: bare.path,
          baseText: "",
          headText: "",
          hasOld: false,
          hasNew: false,
          toolCallIds: [],
          anyFailed: false,
          noDiffData: true,
        };
      if (!existing) {
        byPath.set(bare.path, acc);
      }
      if (!acc.toolCallIds.includes(bare.toolCallId)) {
        acc.toolCallIds.push(bare.toolCallId);
      }
      if (bare.failed) {
        acc.anyFailed = true;
      }
      acc.noDiffData = true;
    }
  }

  const files: ChangeSetFile[] = [];
  let added = 0;
  let removed = 0;
  for (const acc of byPath.values()) {
    if (acc.noDiffData && !acc.hasNew && !acc.hasOld) {
      files.push({
        path: acc.path,
        baseText: "",
        headText: "",
        added: 0,
        removed: 0,
        toolCallIds: acc.toolCallIds,
        status: "no_diff_data",
      });
      continue;
    }
    // Missing oldText on the first fragment → treat as no baseline (whole-file add).
    const status: ChangeSetFileStatus = acc.anyFailed
      ? "failed"
      : !acc.hasOld && acc.hasNew
        ? "no_baseline"
        : "ok";
    const diff = buildFileDiff(acc.baseText, acc.headText);
    files.push({
      path: acc.path,
      baseText: acc.baseText,
      headText: acc.headText,
      added: diff.added,
      removed: diff.removed,
      toolCallIds: acc.toolCallIds,
      status,
      degraded: diff.degraded,
    });
    added += diff.added;
    removed += diff.removed;
  }

  return {
    files,
    fileCount: files.length,
    added,
    removed,
  };
}

/**
 * Build a change set for one turn unit from its tool activity + tool map.
 * @param unit Turn with activity rail (tool groups / tool items).
 * @param toolCalls Session tool-call map.
 */
export function buildTurnChangeSet(
  unit: TurnUnit,
  toolCalls: Record<string, ToolCallCard | undefined>,
): ChangeSet {
  const orderedIds = collectToolCallIdsFromTurn(unit);
  return buildChangeSetFromToolCalls(toolCalls, orderedIds);
}

/**
 * Index turn units by id using the same grouping pipeline as TimelineWidget.
 * Preview drawer uses this so turn-scope changesets resolve without prop-drilling.
 * @param timeline Session timeline items in order.
 * @param toolCalls Session tool-call map (for tool grouping kinds).
 * @returns Map of turn.id → TurnUnit.
 */
export function indexTurnsById(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): Record<string, TurnUnit> {
  const units = buildTimelineRenderUnits(timeline, toolCalls);
  const map: Record<string, TurnUnit> = {};
  for (const unit of units) {
    if (unit.type === "turn") {
      map[unit.id] = unit;
    }
  }
  return map;
}

/**
 * Resolve a turn change set by turn id from live session data.
 * @param turnId TurnUnit.id from TurnBlockWidget / openPreview.
 * @param timeline Session timeline.
 * @param toolCalls Session tool-call map.
 * @returns Change set, or null when the turn id is missing.
 */
export function buildTurnChangeSetById(
  turnId: string,
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): ChangeSet | null {
  const unit = indexTurnsById(timeline, toolCalls)[turnId];
  if (!unit) {
    return null;
  }
  return buildTurnChangeSet(unit, toolCalls);
}

/**
 * Build a session-wide change set from every known tool call.
 * @param toolCalls Session tool-call map.
 * @param orderedIds Optional timeline order of tool ids.
 */
export function buildSessionChangeSet(
  toolCalls: Record<string, ToolCallCard | undefined>,
  orderedIds?: string[],
): ChangeSet {
  return buildChangeSetFromToolCalls(toolCalls, orderedIds);
}

/**
 * Collect toolCallIds in activity order from a turn unit.
 * @param unit Turn with activity children.
 */
export function collectToolCallIdsFromTurn(unit: TurnUnit): string[] {
  const ids: string[] = [];
  for (const child of unit.activity) {
    if (child.type === "tool_group") {
      for (const id of child.toolCallIds) {
        ids.push(id);
      }
      continue;
    }
    if (child.type === "item" && child.item.kind === "tool") {
      ids.push(child.item.toolCallId);
    }
  }
  return ids;
}

