/**
 * One activity-rail step: shared geometry for narration / thought / tool rows.
 * Stateless shell for thought/tool leaves; narration owns local expand only.
 * Mid-turn agent narration is plain clamped text (no Markdown, no Copy).
 * Also used as the single residual renderer for top-level work units.
 */

import cs from "classnames";
import { useState } from "react";
import type { SessionStatus, ToolCallCard } from "@grok-desktop/acp-core";
import type { TurnActivityChild } from "@/lib/turnGrouping";
import { CollapsibleStepView } from "@/widgets/shared";
import { ThoughtGroupView } from "./ThoughtGroupView";
import { ThoughtWidget } from "./ThoughtWidget";
import { ToolCardView } from "./ToolCardView";
import { ToolGroupView } from "./ToolGroupView";

type TurnStepViewProps = {
  /** One activity child in timeline order. */
  child: TurnActivityChild;
  sessionStatus: SessionStatus;
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** True when this is the last step of a live turn (active highlight). */
  active?: boolean;
};

/**
 * Renders one rail step with turn-step geometry (no nested shell-toggle header
 * for narration; thought/tool widgets keep their own expand chrome).
 * @param props Child unit plus session/tool context and optional active flag.
 * @returns listitem row for the activity rail.
 */
export function TurnStepView(props: TurnStepViewProps) {
  const { child, sessionStatus, toolCalls, active } = props;
  const stepClass = cs("turn-step-row", {
    "turn-step-active": Boolean(active),
  });

  if (child.type === "tool_group") {
    return (
      <div className={stepClass} role="listitem" data-kind="turn-step-tools">
        <ToolGroupView
          toolCallIds={child.toolCallIds}
          kinds={child.kinds}
          toolCalls={toolCalls}
        />
      </div>
    );
  }
  if (child.type === "thought_group") {
    return (
      <div className={stepClass} role="listitem" data-kind="turn-step-thoughts">
        <ThoughtGroupView unit={child} />
      </div>
    );
  }
  const item = child.item;
  if (item.kind === "agent") {
    return (
      <NarrationStep text={item.text} active={active} />
    );
  }
  if (item.kind === "thought") {
    return (
      <div className={stepClass} role="listitem" data-kind="turn-step-thought">
        <ThoughtWidget item={item} sessionStatus={sessionStatus} />
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <div className={stepClass} role="listitem" data-kind="turn-step-tool">
        <ToolCardView card={toolCalls[item.toolCallId]} toolCallId={item.toolCallId} />
      </div>
    );
  }
  return null;
}

/**
 * Mid-turn agent narration: plain text, clamp 4 lines, expand on click.
 * Never Markdown and never Copy — answer zone owns those.
 * @param props text Narration body; active highlights the live current step.
 */
function NarrationStep(props: { text: string; active?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const text = props.text;
  if (!text) {
    return null;
  }
  return (
    <CollapsibleStepView
      open={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      label={text}
      body={<div className="turn-step-body">{text}</div>}
      variant="turn-step"
      active={Boolean(props.active)}
      className="turn-step-row"
      dataKind="turn-step-note"
      role="listitem"
      labelClassName={cs({ "turn-step-note": !isOpen })}
    />
  );
}
