/**
 * Final turn answer: full-weight Markdown body + Copy row.
 * Only this zone uses msg-agent-inner-actions / StreamingMarkdownView for agent text.
 * Empty answer while streaming stays blank (no Generating skeleton bars).
 */

import cs from "classnames";
import { StreamingMarkdownView } from "./StreamingMarkdownView";

export type TurnAnswerViewProps = {
  /** Answer body text; empty while the first chunk is still in flight. */
  text: string;
  /** True only for the last streaming agent row of the live turn. */
  showCursor: boolean;
};

/**
 * Renders the high-weight answer bubble for a turn.
 * @param props text + streaming cursor.
 * @returns Answer column with optional Copy, or null when text is empty and not streaming.
 */
export function TurnAnswerView(props: TurnAnswerViewProps) {
  const { text, showCursor } = props;
  // Blank until first character — progress is on the rail header, not skeleton bars.
  if (!text && !showCursor) {
    return null;
  }
  if (!text) {
    return <div className="item-agent" data-kind="agent" />;
  }
  return (
    <div
      className={cs("msg-agent-inner group", "msg-agent-inner-actions")}
      data-kind="turn-answer"
    >
      <div className="item-agent" data-kind="agent">
        <StreamingMarkdownView text={text} showCursor={showCursor} />
      </div>
      <div className="msg-actions">
        <button
          type="button"
          className="msg-action-btn"
          title="Copy"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
