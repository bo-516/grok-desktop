/**
 * Collapsed consecutive read/search/list tool cards (F-TOOL-06).
 */

import { useState } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { toolGroupSummary } from "../../lib/toolGrouping";
import { ToolCardView } from "./ToolCardView";

type ToolGroupViewProps = {
  toolCallIds: string[];
  kinds: string[];
  toolCalls: Record<string, ToolCallCard | undefined>;
};

/**
 * Summary row that expands to individual tool cards.
 * @param props Group membership + card map.
 */
export function ToolGroupView(props: ToolGroupViewProps) {
  const [open, setOpen] = useState(false);
  const summary = toolGroupSummary(props.kinds, props.toolCallIds.length);

  return (
    <div className="tool-group" data-kind="tool-group">
      <button
        type="button"
        className="tool-group-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {summary}
      </button>
      {open
        ? props.toolCallIds.map((id) => (
            <ToolCardView key={id} toolCallId={id} card={props.toolCalls[id]} />
          ))
        : null}
    </div>
  );
}
