/**
 * Syntax-highlight token shortcuts shared by the preview drawer, the structured
 * diff, and Markdown fenced blocks.
 *
 * One class per semantic kind emitted by Shiki's css-variables theme; the class
 * is the ONLY thing business TSX may name, so `--color-code-*` (defineColor.css)
 * stays the single place a theme swap has to touch. `tokenClassName` in
 * `src/lib/codeHighlight.ts` builds these names — keep the two in sync or a kind
 * silently falls back to inherited body text.
 */

export const codeShortcuts: Record<string, string> = {
  /*
   * Base run: inherits body color so "plain" kinds need no class of their own.
   * `whitespace-pre` keeps indentation and suits the horizontally scrolling
   * Markdown fence; wrapping surfaces (preview drawer, structured diff) relax
   * it to pre-wrap on their own text cell — see shortcuts.preview.ts.
   */
  "code-tok": "whitespace-pre",
  "code-tok-keyword": "text-code-keyword",
  "code-tok-control": "text-code-control",
  "code-tok-type": "text-code-type",
  "code-tok-tag": "text-code-tag",
  "code-tok-string": "text-code-string",
  "code-tok-string-expression": "text-code-string-expression",
  "code-tok-comment": "text-code-comment",
  "code-tok-constant": "text-code-constant",
  "code-tok-number": "text-code-number",
  "code-tok-function": "text-code-function",
  "code-tok-punctuation": "text-code-punctuation",
  "code-tok-variable": "text-code-variable",
  "code-tok-parameter": "text-code-parameter",
  "code-tok-link": "text-code-link",
  /* Font-style flags Shiki reports alongside color (italic comments, bold headings). */
  "code-tok-italic": "italic",
  "code-tok-bold": "font-semibold",
  "code-tok-underline": "underline",
  /*
   * Wrapping code cell (preview drawer, structured diff, hunk review).
   *
   * The descendant override is the load-bearing part: `white-space` is set on
   * every token span, so a cell that only sets pre-wrap on itself still gets
   * unwrappable runs and scrolls sideways — which leaves gutters and row
   * backgrounds behind, since both are sized to the viewport, not the content.
   */
  "code-wrap": "whitespace-pre-wrap break-words [&_.code-tok]:whitespace-pre-wrap",
};
