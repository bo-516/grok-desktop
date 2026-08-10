/**
 * Background tasks + subagents panel (F-BG-06 / F-SUB-01).
 */

import { useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  buildKillTaskCommand,
  buildListTasksCommand,
  normalizeBackgroundTasks,
} from "../lib/backgroundTasks";
import { listSubagentCards, subagentSummary } from "../lib/subagentVisibility";
import { SidePanelShell } from "./SidePanelShell";

/**
 * Stateful tasks panel; lists subagents from toolCalls and offers /tasks commands.
 * @param props open/onClose — parent toggles; shell handles dismiss
 */
export function TasksPanelWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const [taskJson, setTaskJson] = useState("");
  const subagents = useMemo(
    () => listSubagentCards(toolCalls),
    [toolCalls],
  );
  const tasks = useMemo(() => {
    try {
      return normalizeBackgroundTasks(taskJson ? JSON.parse(taskJson) : []);
    } catch {
      return [];
    }
  }, [taskJson]);

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
        {subagents.length === 0 ? (
          <p className="side-panel-hint">No active subagent tool cards.</p>
        ) : (
          <ul>
            {subagents.map((c) => (
              <li key={c.toolCallId}>{subagentSummary(c)}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Background tasks</h3>
        <p className="side-panel-hint">
          Paste agent task JSON or use /tasks. Kill via command.
        </p>
        <textarea
          className="text-input"
          rows={3}
          placeholder='[{"terminalId":"t1","command":"npm run dev","status":"running"}]'
          value={taskJson}
          onChange={(e) => setTaskJson(e.target.value)}
        />
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              {t.label} · {t.status}{" "}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void sendPrompt(buildKillTaskCommand(t.id))}
              >
                Kill
              </button>
            </li>
          ))}
        </ul>
      </section>
    </SidePanelShell>
  );
}
