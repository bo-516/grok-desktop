/**
 * Stateful Agents companion: roster plus the clicked child's transcript.
 */

import { AgentsRosterView } from "./AgentsRosterView";
import { SubagentDetailWidget } from "./SubagentDetailWidget";
import { useAgentsPanelWidget } from "./useAgentsPanelWidget";

/**
 * Master–detail Agents tab body. A roster click focuses that child
 * below the list (title-only picker + transcript). Inspect never
 * calls selectSession.
 * @returns Panel bound to the current viewing session's children.
 */
export function AgentsPanelWidget() {
  const model = useAgentsPanelWidget();
  const focusedStartedAt = model.focusedCard
    ? model.startedAtById[
        model.focusedCard.subagentId || model.focusedCard.childSessionId
      ]
    : undefined;

  return (
    <div
      className="agents-panel"
      data-agents-surface="panel"
      tabIndex={0}
      onKeyDown={model.onPanelKeyDown}
    >
      <AgentsRosterView
        goal={model.goal}
        rounds={model.rounds}
        backgroundTasks={model.backgroundTasks}
        focusedChildId={model.highlightedId}
        nowMs={model.nowMs}
        startedAtById={model.startedAtById}
        onFocusChild={model.onFocusChild}
        onPreviewLog={model.onPreviewLog}
        compact={!model.atRoster}
      />
      {model.focusedChildId ? (
        <SubagentDetailWidget
          childSessionId={model.focusedChildId}
          card={model.focusedCard}
          startedAtMs={focusedStartedAt}
          nowMs={model.nowMs}
        />
      ) : null}
    </div>
  );
}
