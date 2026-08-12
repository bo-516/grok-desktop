/**
 * L1 inline subagent fan-out group (Stateful Widget).
 *
 * Subscribes to session.subagents / catalog / selectSession locally so the
 * 4-layer TurnStep → Rail → TurnBlock → Timeline path does not prop-drill.
 * This is the intentional leaf-store exception documented in the design:
 * depth would exceed 2 if parent threads canOpen + onOpen + subagents.
 */

import { useEffect, useMemo, useState } from "react";
import {
  parseSpawnedSubagentId,
  type SubagentCard,
  type ToolCallCard,
} from "@grok-desktop/acp-core";
import {
  countRunningSubagents,
  formatLiveElapsed,
  formatSubagentDuration,
  normalizeSubagentStatus,
} from "@/lib/agentCards";
import type { SubagentGroupUnit } from "@/lib/subagentGrouping";
import { useSessionStore } from "@/store/sessionStore";
import { CollapsibleStepView } from "@/widgets/shared";
import { SubagentStepView } from "./SubagentStepView";

export type SubagentGroupWidgetProps = {
  /** Fan-out unit from the timeline pipeline. */
  unit: SubagentGroupUnit;
  /** Session tool-call map for spawn card titles / meta. */
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** True when this is the last step of a live turn (active highlight). */
  active?: boolean;
};

/**
 * Resolve the orchestration card for a spawn toolCallId via subagentLinks
 * or by parsing the spawn body id (order-independent fallback).
 * @param toolCallId Spawn card id.
 * @param toolCard Spawn tool card (may carry body id before links exist).
 * @param subagents Session subagents map.
 * @param links Session subagentLinks map.
 */
function resolveSubagentForToolCall(
  toolCallId: string,
  toolCard: ToolCallCard | undefined,
  subagents: Record<string, SubagentCard> | undefined,
  links: Record<string, string> | undefined,
): SubagentCard | undefined {
  if (!subagents) {
    return undefined;
  }
  // Prefer reverse lookup from links map.
  if (links) {
    for (const [subId, callId] of Object.entries(links)) {
      if (callId === toolCallId && subagents[subId]) {
        return subagents[subId];
      }
    }
  }
  // Fallback: cards that already have toolCallId set.
  for (const card of Object.values(subagents)) {
    if (card.toolCallId === toolCallId) {
      return card;
    }
  }
  // Last resort: body id on the spawn card.
  const bodyId = parseSpawnedSubagentId(toolCard?.content);
  if (bodyId && subagents[bodyId]) {
    return subagents[bodyId];
  }
  return undefined;
}

/**
 * Stateful fan-out group: collapsible header + per-subagent rows.
 * @param props Unit + toolCalls + optional live active flag.
 * @returns Collapsible turn-step with subagent list body.
 */
export function SubagentGroupWidget(props: SubagentGroupWidgetProps) {
  const { unit, toolCalls, active } = props;
  const subagents = useSessionStore((s) => s.session.subagents);
  const links = useSessionStore((s) => s.session.subagentLinks);
  const catalog = useSessionStore((s) => s.catalog);
  const selectSession = useSessionStore((s) => s.selectSession);
  const [open, setOpen] = useState(Boolean(active));
  const [nowMs, setNowMs] = useState(() => Date.now());
  /**
   * Local start clocks for running cards — not persisted; lost on refresh
   * (honest: better no clock than a fake one after replay).
   */
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});

  const rows = useMemo(() => {
    return unit.toolCallIds.map((toolCallId) => {
      const toolCard = toolCalls[toolCallId];
      const card = resolveSubagentForToolCall(
        toolCallId,
        toolCard,
        subagents,
        links,
      );
      return { toolCallId, toolCard, card };
    });
  }, [unit.toolCallIds, toolCalls, subagents, links]);

  // Record first-seen running time for live elapsed display.
  useEffect(() => {
    setStartedAt((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        const id = row.card?.subagentId ?? row.toolCallId;
        const status = normalizeSubagentStatus(
          row.card?.status ?? row.toolCard?.status,
        );
        if (status === "running" && next[id] === undefined) {
          next[id] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const anyRunning = rows.some(
    (r) =>
      normalizeSubagentStatus(r.card?.status ?? r.toolCard?.status) ===
      "running",
  );

  // Tick only while something is live so finished groups stay quiet.
  useEffect(() => {
    if (!anyRunning) {
      return;
    }
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  const catalogIds = useMemo(
    () => new Set(catalog.map((c) => c.id)),
    [catalog],
  );

  const linkedCards: Record<string, SubagentCard> = {};
  for (const row of rows) {
    if (row.card) {
      linkedCards[row.card.subagentId] = row.card;
    }
  }
  const running = countRunningSubagents(linkedCards);
  const types = [
    ...new Set(
      rows
        .map((r) => r.card?.type)
        .filter((t): t is string => Boolean(t && t.trim())),
    ),
  ];
  const typeLabel = types.length === 1 ? types[0] : undefined;
  const groupDuration = anyRunning
    ? formatLiveElapsed(
        Math.min(
          ...rows
            .map((r) => startedAt[r.card?.subagentId ?? r.toolCallId])
            .filter((n): n is number => typeof n === "number"),
        ),
        nowMs,
      )
    : (() => {
        const ms = rows
          .map((r) => r.card?.durationMs)
          .filter((n): n is number => typeof n === "number");
        if (ms.length === 0) {
          return "";
        }
        return formatSubagentDuration(Math.max(...ms));
      })();

  const headParts = [
    `Subagents ×${unit.toolCallIds.length}`,
    typeLabel,
    running > 0 ? `${running} running` : undefined,
    groupDuration || undefined,
  ].filter(Boolean);

  return (
    <CollapsibleStepView
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={headParts.join(" · ")}
      variant="turn-step"
      active={Boolean(active)}
      dataKind="turn-step-subagents"
      role="listitem"
      className="turn-step-row subagent-group"
      body={
        <div className="subagent-group-body" role="list">
          {rows.map((row) => {
            const id = row.card?.subagentId ?? row.toolCallId;
            const canOpen = Boolean(
              row.card?.childSessionId &&
                catalogIds.has(row.card.childSessionId),
            );
            return (
              <SubagentStepView
                key={row.toolCallId}
                card={row.card}
                toolCard={row.toolCard}
                canOpen={canOpen}
                startedAtMs={startedAt[id]}
                nowMs={nowMs}
                onOpen={selectSession}
              />
            );
          })}
        </div>
      }
    />
  );
}
