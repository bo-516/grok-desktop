/**
 * Non-timeline Agents detail bodies (Stateless). No Streamdown import so
 * tests can render this chrome in Node without the KaTeX CSS loader.
 */

import type { ReactNode } from "react";
import type { SubagentTranscriptPresentation } from "@/lib/subagentContent";

export type SubagentTranscriptFallbackViewProps = {
  /** Presentation that is not a live/cached timeline. */
  presentation: Exclude<SubagentTranscriptPresentation, { kind: "timeline" }>;
  /**
   * Optional rich body (markdown) for output-only. Tests omit this and still
   * get the hint + raw text so the pane is never blank.
   */
  outputSlot?: ReactNode;
};

/**
 * Explicit empty / pending / output-only pane. Never returns an empty tree.
 * The fallback root is flex-1 min-h-0 overflow-y-auto so a long output
 * scrolls inside the detail pane (same height chain as the live timeline).
 * @param props Presentation + optional markdown slot for output-only.
 * @returns Fallback body with a `data-agents-body` marker.
 */
export function SubagentTranscriptFallbackView(
  props: SubagentTranscriptFallbackViewProps,
) {
  const { presentation, outputSlot } = props;
  if (presentation.kind === "outputOnly") {
    return (
      <div className="agents-transcript-fallback" data-agents-body="output-only">
        <p className="agents-transcript-hint">Final output only</p>
        {outputSlot ?? (
          <div className="agents-transcript-output">{presentation.text}</div>
        )}
      </div>
    );
  }
  if (presentation.kind === "pending") {
    const elapsed = presentation.elapsed;
    return (
      <div className="agents-transcript-fallback" data-agents-body="pending">
        <div className="agents-transcript-skeleton" aria-hidden="true" />
        <p className="agents-transcript-hint">
          {elapsed
            ? `Waiting for output · ${elapsed}`
            : "Waiting for output"}
        </p>
      </div>
    );
  }
  return (
    <div className="agents-transcript-fallback" data-agents-body="unavailable">
      <p className="agents-transcript-hint">{presentation.message}</p>
    </div>
  );
}
