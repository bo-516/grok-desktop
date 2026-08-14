/**
 * Narrow child transcript (Stateless except the live/cached TimelineView
 * path, which uses the shared snapshot model). Never paints a blank body.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import type { SubagentTranscriptPresentation } from "@/lib/subagentContent";
import { TimelineView } from "@/widgets/timeline/TimelineView";
import { useTimelineModel } from "@/widgets/timeline/useTimelineModel";
import { StreamingMarkdownView } from "@/widgets/timeline/StreamingMarkdownView";
import { SubagentTranscriptFallbackView } from "./SubagentTranscriptFallbackView";
import { SubagentTimelineFrameView } from "./SubagentTimelineFrameView";

export type SubagentTranscriptViewProps = {
  /** Explicit body variant from {@link resolveSubagentTranscriptPresentation}. */
  presentation: SubagentTranscriptPresentation;
  /**
   * Stick-to-bottom key, namespaced `agents:<childId>` so the main canvas
   * scroll pin is not shared.
   */
  scrollKey: string;
};

/**
 * Dispatch the four content kinds (plus pending / failed banners) to a
 * non-blank body. Timeline path is the same render-unit pipeline as the canvas.
 * @param props Presentation + isolated scroll key.
 * @returns Detail body for the Agents drawer.
 */
export function SubagentTranscriptView(props: SubagentTranscriptViewProps) {
  const { presentation, scrollKey } = props;
  if (presentation.kind === "timeline") {
    return (
      <SubagentLiveTranscriptView
        state={presentation.state}
        scrollKey={scrollKey}
        source={presentation.source}
      />
    );
  }
  return (
    <SubagentTranscriptFallbackView
      presentation={presentation}
      outputSlot={
        presentation.kind === "outputOnly" ? (
          <StreamingMarkdownView text={presentation.text} />
        ) : undefined
      }
    />
  );
}

/**
 * Live / cached snapshot rendered through the shared timeline model.
 * @param props Child session snapshot, scroll identity, source kind.
 */
function SubagentLiveTranscriptView(props: {
  state: SessionState;
  scrollKey: string;
  source: "live" | "cached";
}) {
  const { state, scrollKey, source } = props;
  const model = useTimelineModel({
    session: state,
    scrollKey,
    restoring: false,
  });
  return (
    <SubagentTimelineFrameView source={source}>
      <TimelineView {...model} compact />
    </SubagentTimelineFrameView>
  );
}

export { SubagentTranscriptFallbackView } from "./SubagentTranscriptFallbackView";
