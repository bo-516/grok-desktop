/**
 * Source text rendered as syntax-highlighted runs, with a plain-text fallback.
 * Every code surface goes through this so highlighted and unhighlighted output
 * are byte-identical in layout — the only difference is that runs carry a color
 * class. Optional word-emphasis ranges split tokens at range edges for diff.
 */

import type { ReactNode } from "react";
import cs from "classnames";
import { tokenClassName, type CodeToken } from "@/lib/codeHighlight";
import { splitTokensByRanges } from "@/lib/diffTokenSplit";
import type { EmphRange } from "@/lib/diffWordRanges";

export type CodeLineViewProps = {
  /** Raw text; rendered verbatim whenever `tokens` is absent. */
  text: string;
  /**
   * Tokens for this exact text. Undefined means "not highlighted" (pending,
   * unknown file type, or over the size guard) and must render as plain text —
   * passing tokens from different text would silently corrupt the display.
   */
  tokens?: CodeToken[];
  /**
   * Line-local character ranges that need word-level emphasis (diff only).
   * Intersected with tokens via splitTokensByRanges; empty/omitted → no emph.
   */
  emph?: EmphRange[];
  /**
   * Emph wash semantic: add → `diff-emph-add`, del → `diff-emph-del`.
   * Required when `emph` is non-empty; ignored otherwise.
   */
  emphKind?: "add" | "del";
};

/**
 * Render tokens (optionally split by emph ranges), or the raw text when tokens
 * are unavailable. When tokens are missing but emph ranges exist, plain text
 * is still returned without emph — callers that need emph without highlighting
 * can pass a single plain token covering the line.
 *
 * @param props Text plus optional tokens and line-local emph ranges.
 */
export function CodeLineView(props: CodeLineViewProps): ReactNode {
  const { text, tokens, emph, emphKind } = props;
  if (!tokens) {
    return text;
  }
  if (!emph || emph.length === 0 || !emphKind) {
    return tokens.map((token) => (
      <span key={token.offset} className={tokenClassName(token)}>
        {token.content}
      </span>
    ));
  }
  /*
   * CodeToken.offset is file-global; EmphRange is line-local. base is the
   * line start so intersection stays correct for rows deep in the file.
   * Empty-token lines skip (splitTokensByRanges returns []).
   */
  const base = tokens[0]?.offset ?? 0;
  const parts = splitTokensByRanges(tokens, emph, base);
  return parts.map((part) => (
    <span
      key={part.offset}
      className={cs(tokenClassName(part), {
        "diff-emph-add": part.emph && emphKind === "add",
        "diff-emph-del": part.emph && emphKind === "del",
      })}
    >
      {part.content}
    </span>
  ));
}
