/**
 * Renders a plain string with its `@file` / `/command` tokens promoted to
 * accent spans — the same visual language as the composer textarea mirror.
 *
 * History messages make file tokens keyboard-accessible buttons that open
 * the preview drawer. Composer draft chips stay non-interactive (caret
 * metrics). `/command` tokens remain non-clickable accents.
 *
 * Text runs are emitted verbatim — the caller's container keeps
 * `white-space: pre-wrap`, so newlines and runs of spaces survive. Selection
 * copies the full token (including `@` / `/`) because the glyph stays in the DOM.
 */

import cs from "classnames";
import { mentionKindClass, splitMentionTokens } from "@/lib/mentionTokens";
import { usePreviewStore } from "@/store/previewStore";

type MentionTextViewProps = {
  /** Message text exactly as sent; never HTML — segments are rendered as React nodes. */
  text: string;
  className?: string;
};

/**
 * Renders message text with inline mention accents (textarea style).
 * File tokens open the preview drawer; commands stay inert spans.
 * @param props Source text and optional wrapper classes.
 * @returns A fragment of text runs and accent spans/buttons.
 */
export function MentionTextView(props: MentionTextViewProps) {
  const { text, className } = props;
  const openPreview = usePreviewStore((s) => s.openPreview);
  const segments = splitMentionTokens(text);

  return (
    <span className={className}>
      {segments.map((segment) => {
        if (segment.type === "text") {
          return <span key={`t-${segment.offset}`}>{segment.text}</span>;
        }
        if (segment.kind === "file") {
          // Token text includes leading `@`; path is the remainder.
          const path = segment.text.startsWith("@")
            ? segment.text.slice(1)
            : segment.text;
          return (
            <button
              key={`m-${segment.offset}`}
              type="button"
              className={cs(
                "composer-mention",
                "composer-mention-file-btn",
                mentionKindClass(segment.kind),
              )}
              data-mention-kind={segment.kind}
              title={`Preview ${path}`}
              onClick={() => {
                openPreview({ kind: "file", path });
              }}
            >
              {segment.text}
            </button>
          );
        }
        return (
          <span
            key={`m-${segment.offset}`}
            className={cs("composer-mention", mentionKindClass(segment.kind))}
            data-mention-kind={segment.kind}
            title={segment.text}
          >
            {segment.text}
          </span>
        );
      })}
    </span>
  );
}
