/**
 * Turn attribution for the git change list. Git diff is the source of truth
 * for *what* changed; agent tool cards only answer *which turn touched a
 * file*, so each git row can carry "Turn 3" chips and a turn summary can
 * filter the list to its own files. Pure: no store, no bridge.
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import {
  collectToolCallIdsFromTurn,
  extractDiffFragmentsFromCard,
  extractNoDiffEditPaths,
} from "./changeSet";
import { stripFileUri } from "./pathDisplay";
import { buildTimelineRenderUnits } from "./timelinePipeline";
import type { TurnUnit } from "./turnGrouping";

/** One turn that touched a file. */
export type GitTurnRef = {
  /** TurnUnit.id (matches the changeset preview target). */
  turnId: string;
  /** 1-based position among the session's turns ("Turn 3"). */
  index: number;
};

/** Repo-relative path → turns that touched it, in timeline order. */
export type GitTurnAttribution = Map<string, GitTurnRef[]>;

/**
 * Collapse `.` / `..` segments of a slash path without touching the disk.
 * @param path Absolute or relative posix path.
 * @returns Normalized path; leading `..` that would climb above root are dropped.
 */
function normalizePosix(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return (absolute ? "/" : "") + out.join("/");
}

/**
 * Candidate spellings of an absolute root: macOS reports temp / home
 * workspaces as both `/var/…` and `/private/var/…`.
 * @param root Absolute posix root.
 * @returns The root plus its `/private` alias.
 */
function rootAliases(root: string): string[] {
  if (root.startsWith("/private/")) {
    return [root, root.slice("/private".length)];
  }
  return [root, `/private${root}`];
}

/**
 * Map a tool-card path onto the repo-relative form git prints.
 * Relative tool paths resolve against the session workspace (the agent cwd).
 * Windows separators and drive letters are folded to `/` so both sides compare.
 * @param raw Path or file URI from a tool card.
 * @param root Absolute work-tree root from git.
 * @param workspace Absolute session workspace.
 * @returns Repo-relative path, or null when outside the repo / unknown.
 */
export function toRepoRelativePath(
  raw: string,
  root: string,
  workspace: string,
): string | null {
  const cleaned = stripFileUri(raw).trim().replace(/\\/g, "/");
  if (!cleaned || cleaned === "(unknown)" || !root) {
    return null;
  }
  const isAbs = cleaned.startsWith("/") || /^[A-Za-z]:\//.test(cleaned);
  const ws = workspace.replace(/\\/g, "/");
  const abs = normalizePosix(isAbs ? cleaned : `${ws}/${cleaned}`);
  const rootPosix = normalizePosix(root.replace(/\\/g, "/"));
  for (const candidate of rootAliases(rootPosix)) {
    const lowerSafe = /^[A-Za-z]:/.test(candidate);
    const a = lowerSafe ? abs.toLowerCase() : abs;
    const r = lowerSafe ? candidate.toLowerCase() : candidate;
    if (a.startsWith(`${r}/`)) {
      return abs.slice(candidate.length + 1);
    }
  }
  return null;
}

/**
 * Repo-relative paths touched by the given tool calls (diff fragments plus
 * edit cards without diff data, e.g. shell-driven edits with locations).
 * @param toolCalls Session tool-call map.
 * @param toolCallIds Ids to scan.
 * @param root Work-tree root.
 * @param workspace Session workspace.
 * @returns Set of repo-relative paths.
 */
export function pathsTouchedByToolCalls(
  toolCalls: Record<string, ToolCallCard | undefined>,
  toolCallIds: readonly string[],
  root: string,
  workspace: string,
): Set<string> {
  const out = new Set<string>();
  for (const id of toolCallIds) {
    const card = toolCalls[id];
    const raw = [
      ...extractDiffFragmentsFromCard(id, card).map((f) => f.path),
      ...extractNoDiffEditPaths(id, card).map((p) => p.path),
    ];
    for (const p of raw) {
      const rel = toRepoRelativePath(p, root, workspace);
      if (rel) {
        out.add(rel);
      }
    }
  }
  return out;
}

/**
 * Attribute repo-relative paths to the turns whose tool cards touched them.
 * @param timeline Session timeline.
 * @param toolCalls Session tool-call map.
 * @param root Work-tree root ("" yields an empty map).
 * @param workspace Session workspace.
 * @returns Path → turn refs (each turn at most once per path, timeline order).
 */
export function buildGitTurnAttribution(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
  root: string,
  workspace: string,
): GitTurnAttribution {
  const map: GitTurnAttribution = new Map();
  if (!root) {
    return map;
  }
  const turns = buildTimelineRenderUnits(timeline, toolCalls).filter(
    (u): u is TurnUnit => u.type === "turn",
  );
  turns.forEach((unit, i) => {
    const ids = collectToolCallIdsFromTurn(unit);
    const ref: GitTurnRef = { turnId: unit.id, index: i + 1 };
    for (const path of pathsTouchedByToolCalls(toolCalls, ids, root, workspace)) {
      const refs = map.get(path) ?? [];
      refs.push(ref);
      map.set(path, refs);
    }
  });
  return map;
}
