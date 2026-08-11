/**
 * Source text rendered as syntax-highlighted runs, with a plain-text fallback.
 * Every code surface goes through this so highlighted and unhighlighted output
 * are byte-identical in layout — the only difference is that runs carry a color
 * class.
 */

import type { ReactNode } from "react";
import { tokenClassName, type CodeToken } from "@/lib/codeHighlight";

export type CodeLineViewProps = {
  /** Raw text; rendered verbatim whenever `tokens` is absent. */
  text: string;
  /**
   * Tokens for this exact text. Undefined means "not highlighted" (pending,
   * unknown file type, or over the size guard) and must render as plain text —
   * passing tokens from different text would silently corrupt the display.
   */
  tokens?: CodeToken[];
};

/**
 * Render tokens, or the raw text when tokens are unavailable.
 * @param props Text plus optional tokens for that same text.
 */
export function CodeLineView(props: CodeLineViewProps): ReactNode {
  const { text, tokens } = props;
  if (!tokens) {
    return text;
  }
  return tokens.map((token) => (
    <span key={token.offset} className={tokenClassName(token)}>
      {token.content}
    </span>
  ));
}
