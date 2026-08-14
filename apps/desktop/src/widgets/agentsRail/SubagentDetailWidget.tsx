/**
 * Focused-child detail (Stateful): subscribes to one child buffer only,
 * resolves local content, and renders head + transcript.
 */

import { useMemo } from "react";
import type { SubagentCard } from "@grok-desktop/acp-core";
import {
  resolveSubagentContent,
  resolveSubagentTranscriptPresentation,
} from "@/lib/subagentContent";
import { useSessionStore } from "@/store/sessionStore";
import { SubagentDetailHeadView } from "./SubagentDetailHeadView";
import { SubagentTranscriptView } from "./SubagentTranscriptView";

export type SubagentDetailWidgetProps = {
  /** Focused child ACP session id. */
  childSessionId: string;
  /** Orchestration card for this child when the parent still has it. */
  card: SubagentCard | undefined;
  /** Shared first-seen running clock. */
  startedAtMs?: number;
  /** Shared ticker instant. */
  nowMs?: number;
};

/**
 * Detail pane for one focused child. Subscribes to
 * `childSessions[id]` / `pendingSessions[id]` — not the whole maps.
 * @param props Child id, card, live clock.
 * @returns Meta strip (no duplicate title) + non-blank transcript body.
 */
export function SubagentDetailWidget(props: SubagentDetailWidgetProps) {
  const { childSessionId, card, startedAtMs, nowMs } = props;
  const liveChild = useSessionStore(
    (s) => s.childSessions[childSessionId],
  );
  const pendingChild = useSessionStore(
    (s) => s.pendingSessions[childSessionId],
  );
  const catalogRow = useSessionStore((s) =>
    s.catalog.find((row) => row.id === childSessionId),
  );

  const content = useMemo(
    () =>
      resolveSubagentContent(
        childSessionId,
        {
          childSessions: liveChild
            ? { [childSessionId]: liveChild }
            : {},
          pendingSessions: pendingChild
            ? { [childSessionId]: pendingChild }
            : {},
          catalog: catalogRow ? [catalogRow] : [],
        },
        card,
      ),
    [childSessionId, liveChild, pendingChild, catalogRow, card],
  );

  const presentation = useMemo(
    () =>
      resolveSubagentTranscriptPresentation({
        content,
        card,
        startedAtMs,
        nowMs,
      }),
    [content, card, startedAtMs, nowMs],
  );

  const ended =
    presentation.kind === "timeline" ? presentation.ended : false;
  const error =
    presentation.kind === "timeline" ||
    presentation.kind === "outputOnly" ||
    presentation.kind === "unavailable"
      ? presentation.error
      : undefined;

  return (
    <div className="agents-detail" data-agents-surface="detail">
      <SubagentDetailHeadView
        card={card}
        ended={ended}
        error={error}
        startedAtMs={startedAtMs}
        nowMs={nowMs}
      />
      <SubagentTranscriptView
        presentation={presentation}
        scrollKey={`agents:${childSessionId}`}
      />
    </div>
  );
}
