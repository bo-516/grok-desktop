/**
 * React binding for the shared Shiki highlighter.
 * Owns the async tokenize lifecycle so every code surface (preview drawer,
 * structured diff, Markdown fences) degrades to plain text the same way.
 */

import { useDeferredValue, useEffect, useState } from "react";
import { highlightToLines, type CodeLine } from "@/lib/codeHighlight";
import type { CodeLanguage } from "@/lib/codeHighlightLanguages";

/** Tokenized source plus the exact text it was produced from. */
type HighlightState = { code: string; lines: CodeLine[] } | null;

/**
 * Tokenize `code` for `language`, re-running whenever either changes.
 *
 * The result is gated on an exact text match: tokens produced for an older
 * revision are dropped rather than rendered, because a caller that renders
 * token content would otherwise paint stale source while streaming. Callers
 * therefore see plain text until tokens for the *current* text land, and never
 * a mix of the two.
 *
 * @param code Source text to tokenize; pass "" to disable.
 * @param language Grammar id, or null for unknown file types (disables work).
 * @returns Per-line tokens for exactly this `code`, or null while pending, when
 *   the size guards reject it, or when the file type has no grammar. Null is
 *   the signal to render the caller's plain-text fallback — it is never an
 *   error state and needs no user-facing message.
 */
export function useCodeHighlight(
  code: string,
  language: CodeLanguage | null,
): CodeLine[] | null {
  /*
   * Streaming agent output rewrites a fence on every chunk. Deferring lets
   * React keep painting new text at full rate and run tokenization only when it
   * has slack, instead of tokenizing the whole block per keystroke-sized delta.
   */
  const deferredCode = useDeferredValue(code);
  const [state, setState] = useState<HighlightState>(null);

  useEffect(() => {
    if (!language || deferredCode === "") {
      setState(null);
      return;
    }
    let cancelled = false;
    void highlightToLines(deferredCode, language).then((lines) => {
      if (cancelled) {
        return;
      }
      setState(lines ? { code: deferredCode, lines } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [deferredCode, language]);

  return state && state.code === code ? state.lines : null;
}
