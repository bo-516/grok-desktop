/**
 * Stateful Agents rail body: wires session subagents / background tasks /
 * catalog membership into {@link AgentsRailView}.
 */

import { useMemo } from "react";
import {
  groupSubagentsByRound,
  listBackgroundTaskCards,
} from "@/lib/agentCards";
import { usePreviewStore } from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import { AgentsRailView } from "./AgentsRailView";

/**
 * Subscribe to current-session orchestration maps and render the Agents body.
 * @returns AgentsRailView bound to the live session store.
 */
export function AgentsRailWidget() {
  const goal = useSessionStore((s) => s.session.goal);
  const subagents = useSessionStore((s) => s.session.subagents);
  const backgroundTasks = useSessionStore((s) => s.session.backgroundTasks);
  const catalog = useSessionStore((s) => s.catalog);
  const selectSession = useSessionStore((s) => s.selectSession);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const workspace = useSessionStore((s) => s.session.workspace);

  const rounds = useMemo(() => groupSubagentsByRound(subagents), [subagents]);
  const tasks = useMemo(
    () => listBackgroundTaskCards(backgroundTasks),
    [backgroundTasks],
  );
  const catalogIds = useMemo(
    () => new Set(catalog.map((c) => c.id)),
    [catalog],
  );

  return (
    <AgentsRailView
      goal={goal}
      rounds={rounds}
      backgroundTasks={tasks}
      catalogIds={catalogIds}
      onOpenChild={selectSession}
      onPreviewLog={(path) => {
        // Log paths live under ~/.grok sessions terminal, not the workspace.
        // Bridge may reject out-of-workspace reads; preview shows the error
        // rather than inventing a fake slash kill/refresh path.
        openPreview({ kind: "file", path, cwd: workspace || undefined });
      }}
    />
  );
}
