/**
 * Collapsed consecutive read/search/list tool cards (F-TOOL-06) inside a turn rail.
 * Uses turn-step geometry; shell-toggle is reserved for the turn rail header only.
 * Expand chrome is {@link CollapsibleStepView}; local open state only.
 */

import { useState } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { toolGroupSummary } from "../../lib/toolGrouping";
import { CollapsibleStepView } from "@/widgets/shared";
import { ToolCardView } from "./ToolCardView";

type ToolGroupViewProps = {
  /** Tool call ids in timeline order for this collapsed group. */
  toolCallIds: string[];
  /** Kind strings parallel to toolCallIds (for summary label). */
  kinds: string[];
  /** Live card map; missing ids still render a fallback row via ToolCardView. */
  toolCalls: Record<string, ToolCallCard | undefined>;
};

/**
 * Summary row that expands to individual tool cards.
 * @param props Group membership + card map.
 * @returns Collapsed turn-step toggle, or expanded list of tool cards under it.
 */
export function ToolGroupView(props: ToolGroupViewProps) {
  const [open, setOpen] = useState(false);
  const summary = toolGroupSummary(props.kinds, props.toolCallIds.length);

  return (
    <CollapsibleStepView
      open={open}
      onToggle={() => setOpen((v) => !v)}
      label={summary}
      body={
        <>
          {props.toolCallIds.map((id) => (
            <ToolCardView key={id} toolCallId={id} card={props.toolCalls[id]} />
          ))}
        </>
      }
      variant="turn-step"
      className="tool-group"
      dataKind="tool-group"
    />
  );
}
