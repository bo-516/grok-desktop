/**
 * Unified Agents panel hook: store focus, session roster, optional keys.
 * A roster click focuses that child; Home / [ / ] remain keyboard-only.
 * Background-task rows preview logs via {@link previewLogReadCwd} so the
 * session-terminal path is not rejected as outside the project workspace.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  countRunningSubagents,
  groupSubagentsByRound,
  listBackgroundTaskCards,
  mergeSubagentsWithSpawnTools,
} from "@/lib/agentCards";
import { inspectSubagentInPanel } from "@/lib/inspectSubagent";
import { previewLogReadCwd } from "@/lib/previewLogPath";
import { orderedSubagentSessionIds } from "@/lib/subagentContent";
import {
  effectiveAgentsFocus,
  useAgentsPanelStore,
  type AgentsFocus,
} from "@/store/agentsPanelStore";
import { usePreviewStore } from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import {
  rememberSubagentStartedAt,
  useElapsedTicker,
} from "@/widgets/shared";

/**
 * Map a keydown on the Agents panel to a cycle / home action.
 * @param args Native key + current focus + whether any children exist.
 * @returns Action the hook should run, or `none`.
 */
export function agentsPanelKeyAction(args: {
  key: string;
  altKey: boolean;
  atRoster: boolean;
  hasChildren: boolean;
}): "home" | "next" | "prev" | "none" {
  const { key, altKey, atRoster, hasChildren } = args;
  if (key === "Home") {
    return atRoster ? "none" : "home";
  }
  if (!hasChildren) {
    return "none";
  }
  if (key === "]" || (altKey && key === "ArrowDown")) {
    return "next";
  }
  if (key === "[" || (altKey && key === "ArrowUp")) {
    return atRoster ? "none" : "prev";
  }
  return "none";
}

/**
 * Compose roster + focus + handlers for {@link AgentsPanelWidget}.
 * @returns Props bundle for the roster and optional detail pane.
 */
export function useAgentsPanelWidget() {
  const goal = useSessionStore((s) => s.session.goal);
  const subagents = useSessionStore((s) => s.session.subagents);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const backgroundTasks = useSessionStore((s) => s.session.backgroundTasks);
  const viewingSessionId = useSessionStore(
    (s) => s.viewingSessionId ?? s.session.id,
  );
  const focus = useAgentsPanelStore((s) => s.focus);
  const ownerSessionId = useAgentsPanelStore((s) => s.ownerSessionId);
  const focusRoster = useAgentsPanelStore((s) => s.focusRoster);
  const cycle = useAgentsPanelStore((s) => s.cycle);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const workspace = useSessionStore((s) => s.session.workspace);

  const effective: AgentsFocus = effectiveAgentsFocus(
    focus,
    ownerSessionId,
    viewingSessionId || null,
  );
  /**
   * Spawn tools already paint L1 groups; merge so the companion roster
   * is not empty when `session.subagents` never received orchestration.
   */
  const rosterSubagents = useMemo(
    () => mergeSubagentsWithSpawnTools(subagents, toolCalls),
    [subagents, toolCalls],
  );
  const orderedIds = useMemo(
    () => orderedSubagentSessionIds(rosterSubagents),
    [rosterSubagents],
  );
  const rounds = useMemo(
    () => groupSubagentsByRound(rosterSubagents),
    [rosterSubagents],
  );
  const tasks = useMemo(
    () => listBackgroundTaskCards(backgroundTasks),
    [backgroundTasks],
  );
  const runningCount = countRunningSubagents(rosterSubagents);
  const nowMs = useElapsedTicker(runningCount > 0);
  const [startedAtById, setStartedAtById] = useState<Record<string, number>>(
    {},
  );
  useEffect(() => {
    setStartedAtById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const round of rounds) {
        for (const card of round.cards) {
          if (card.status !== "running") {
            continue;
          }
          const key = card.subagentId || card.childSessionId;
          if (next[key] !== undefined) {
            continue;
          }
          next[key] = rememberSubagentStartedAt(key, Date.now());
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rounds]);

  const atRoster = effective.kind === "roster";
  const focusedChildId =
    effective.kind === "subagent" ? effective.childSessionId : null;
  const focusedCard = useMemo(() => {
    if (!focusedChildId) {
      return undefined;
    }
    for (const round of rounds) {
      for (const card of round.cards) {
        if (card.childSessionId === focusedChildId) {
          return card;
        }
      }
    }
    return undefined;
  }, [rounds, focusedChildId]);

  const [highlightIndex, setHighlightIndex] = useState(0);
  useEffect(() => {
    if (orderedIds.length === 0) {
      setHighlightIndex(0);
      return;
    }
    setHighlightIndex((i) => Math.min(i, orderedIds.length - 1));
  }, [orderedIds.length]);

  /**
   * Focus a child in the companion. Does not select a session.
   * @param childSessionId Child ACP session id from the clicked roster row.
   */
  const onFocusChild = useCallback(
    (childSessionId: string) => {
      const owner = viewingSessionId || "";
      inspectSubagentInPanel(childSessionId, owner);
    },
    [viewingSessionId],
  );

  /**
   * Roster highlight + optional Home / [ / ] cycle. Click is the
   * primary inspect path; these keys stay for keyboard-only use.
   * @param event Native key event from the panel root.
   */
  const onPanelKeyDown = useCallback(
    (event: { key: string; altKey: boolean; preventDefault: () => void }) => {
      if (atRoster && orderedIds.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, orderedIds.length - 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          const id = orderedIds[highlightIndex];
          if (id) {
            event.preventDefault();
            onFocusChild(id);
          }
          return;
        }
      }
      const action = agentsPanelKeyAction({
        key: event.key,
        altKey: event.altKey,
        atRoster,
        hasChildren: orderedIds.length > 0,
      });
      if (action === "none") {
        return;
      }
      event.preventDefault();
      if (action === "home") {
        focusRoster();
        return;
      }
      cycle(action === "next" ? 1 : -1, orderedIds);
    },
    [
      atRoster,
      orderedIds,
      highlightIndex,
      onFocusChild,
      focusRoster,
      cycle,
    ],
  );

  const highlightedId =
    focusedChildId ??
    (atRoster ? (orderedIds[highlightIndex] ?? null) : null);

  return {
    goal,
    rounds,
    backgroundTasks: tasks,
    atRoster,
    focusedChildId,
    focusedCard,
    highlightedId,
    nowMs,
    startedAtById,
    ownerSessionId: viewingSessionId || "",
    onFocusChild,
    onPanelKeyDown,
    /**
     * Preview a background-task log. The path is under
     * `<session>/terminal/`, not the project workspace — sandbox cwd is
     * the log parent so the bridge does not reject it as `outside`.
     */
    onPreviewLog: (path: string) => {
      openPreview({
        kind: "file",
        path,
        cwd: previewLogReadCwd(path, workspace),
      });
    },
  };
}

export type AgentsPanelWidgetModel = ReturnType<typeof useAgentsPanelWidget>;
