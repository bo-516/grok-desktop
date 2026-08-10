/**
 * Background tasks + subagents panel (F-BG-06 / F-SUB-01).
 * Cards come from session orchestration state (`subagents` / `backgroundTasks`),
 * not tool-call title regex.
 */

import { useMemo } from "react";
import type { BackgroundTaskCard, SubagentCard } from "@grok-desktop/acp-core";
import { useSessionStore } from "../store/sessionStore";
import {
  buildKillTaskCommand,
  buildListTasksCommand,
} from "../lib/backgroundTasks";
import {
  listOrchestrationBackgroundTasks,
  listOrchestrationSubagentCards,
} from "../lib/orchestrationCards";
import { SidePanelShell } from "./SidePanelShell";

/**
 * Format subagent duration for the card line.
 * @param ms Duration in milliseconds, or undefined when unreported.
 * @returns Human-readable duration, or empty when missing.
 */
function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

/**
 * One-line summary for a subagent card in the panel list.
 * @param card Orchestration subagent card (camelCase).
 * @returns Display string with role, status, and optional metrics.
 */
function subagentCardLine(card: SubagentCard): string {
  const parts = [card.description || card.type || card.subagentId, card.status];
  const duration = formatDuration(card.durationMs);
  if (duration) {
    parts.push(duration);
  }
  if (typeof card.tokensUsed === "number") {
    parts.push(`${card.tokensUsed} tokens`);
  }
  if (typeof card.toolCalls === "number") {
    parts.push(`${card.toolCalls} tools`);
  }
  return parts.join(" · ");
}

/**
 * One-line summary for a background task card.
 * @param card Orchestration background task card.
 * @returns Display string with label and status.
 */
function backgroundTaskLine(card: BackgroundTaskCard): string {
  const label = card.description || card.command || card.taskId;
  return `${label} · ${card.status}`;
}

/**
 * Stateful tasks panel; lists subagents and background tasks from session state.
 * @param props open/onClose — parent toggles; shell handles dismiss
 */
export function TasksPanelWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const subagents = useSessionStore((s) => s.session.subagents);
  const backgroundTasks = useSessionStore((s) => s.session.backgroundTasks);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const selectSession = useSessionStore((s) => s.selectSession);
  /** Insertion order is spawn order, which matches the orchestrator's fan-out. */
  const cards = useMemo(
    () => listOrchestrationSubagentCards(subagents),
    [subagents],
  );
  const tasks = useMemo(
    () => listOrchestrationBackgroundTasks(backgroundTasks),
    [backgroundTasks],
  );

  return (
    <SidePanelShell
      open={props.open}
      label="Tasks"
      title="Tasks & subagents"
      onClose={props.onClose}
    >
      {/* Sections own the drawer's vertical rhythm — side-panel-body adds no gap. */}
      <section className="side-panel-section">
        <div className="side-panel-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void sendPrompt(buildListTasksCommand())}
          >
            Refresh /tasks
          </button>
        </div>
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Subagents</h3>
        {cards.length === 0 ? (
          <p className="side-panel-hint">No subagents in this session yet.</p>
        ) : (
          <ul>
            {cards.map((c) => (
              <li key={c.subagentId}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => selectSession(c.childSessionId)}
                  title={`Open ${c.childSessionId}`}
                >
                  {subagentCardLine(c)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Background tasks</h3>
        {tasks.length === 0 ? (
          <p className="side-panel-hint">No background tasks reported.</p>
        ) : (
          <ul>
            {tasks.map((t) => (
              <li key={t.taskId}>
                {backgroundTaskLine(t)}{" "}
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void sendPrompt(buildKillTaskCommand(t.taskId))}
                >
                  Kill
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SidePanelShell>
  );
}
