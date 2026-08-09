/**
 * Renders a plain string with its `@file` / `/command` tokens promoted to chips.
 *
 * This is the read-only counterpart of the composer mirror layer: the same
 * parser decides what a token is, so a message looks the same after sending as
 * it did while typing. Text runs are emitted verbatim — the caller's container
 * keeps `white-space: pre-wrap`, so newlines and runs of spaces survive.
 */

import { splitMentionTokens, mentionDisplayLabel } from "@/lib/mentionTokens";
import { MentionChipView } from "./MentionChipView";

type MentionTextViewProps = {
  /** Message text exactly as sent; never HTML — segments are rendered as React nodes. */
  text: string;
  className?: string;
};

/**
 * Renders message text with inline mention chips.
 * @param props Source text and optional wrapper classes.
 * @returns A fragment of text runs and chips; text without tokens renders as a
 *   single run, so ordinary messages pay no visual or structural cost.
 */
export function MentionTextView(props: MentionTextViewProps) {
  const { text, className } = props;
  const segments = splitMentionTokens(text);

  return (
    <span className={className}>
      {segments.map((segment) => {
        if (segment.type === "text") {
          return <span key={`t-${segment.offset}`}>{segment.text}</span>;
        }
        return (
          <MentionChipView
            key={`m-${segment.offset}`}
            kind={segment.kind}
            label={mentionDisplayLabel(segment.body)}
            title={segment.text}
          />
        );
      })}
    </span>
  );
}
