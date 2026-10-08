/**
 * Cheap "could this Markdown contain math?" probe used to decide whether the
 * KaTeX pipeline (`@streamdown/math` + `katex`, ~270 kB minified) must be
 * loaded for a given message or document.
 *
 * Contract: the probe is a **superset** of what remark-math@6 would parse as
 * math. A false positive only loads KaTeX early (render output is unchanged);
 * a false negative would leave `$…$` as literal text, so every rule below
 * errs toward `true`.
 *
 * Boundaries:
 * - Fenced code blocks (``` / ~~~) and single-line inline code spans are
 *   ignored: remark-math never parses inside them, and shell snippets full of
 *   `$HOME` / `$ npm test` are the common case in coding-agent answers.
 * - Escaped `\$` still counts (over-reporting is safe).
 * - Pure function; O(n) and short-circuits when the text has no `$` at all,
 *   so it is safe to call on every streaming tick.
 */

/** Opening/closing line of a Markdown code fence (same rule as normalizeAgentMath). */
const CODE_FENCE_LINE = /^[ \t]*(?:```|~~~)/;

/** Single-line inline code span; its content can never become math. */
const INLINE_CODE_SPAN = /`[^`\n]*`/g;

/** Options that mirror the remark-math flavour the caller renders with. */
export type MathDelimiterOptions = {
  /**
   * Mirrors remark-math `singleDollarTextMath`. When true (agent answers),
   * any two `$` outside code may open/close inline math. When false (disk
   * documents), only `$$` can start math, so a lone `$5` never loads KaTeX.
   */
  singleDollar: boolean;
};

/**
 * Strip fenced code blocks and inline code spans, keeping only prose lines.
 * An unclosed fence hides the rest of the text, matching CommonMark (and the
 * streaming case where the closing fence has not arrived yet).
 * @param text Raw Markdown (may be mid-stream / incomplete).
 * @returns Prose with code removed; line structure is not preserved.
 */
function proseOutsideCode(text: string): string {
  const prose: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (CODE_FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      prose.push(line.replace(INLINE_CODE_SPAN, ""));
    }
  }
  return prose.join("\n");
}

/**
 * True when `text` may contain math that remark-math would render.
 * @param text Markdown to probe (agent text after normalizeAgentMath, or a file).
 * @param options `singleDollar` must match the math plugin config the caller
 *   renders with; passing `false` for an agent message would miss `$x$` math.
 * @returns false only when the text certainly has no math delimiters.
 */
export function hasMathDelimiters(
  text: string,
  options: MathDelimiterOptions,
): boolean {
  if (!text.includes("$")) {
    return false;
  }
  const prose = proseOutsideCode(text);
  if (options.singleDollar) {
    // Inline math needs an opening and a closing `$`; flow math needs `$$`.
    return prose.indexOf("$") !== prose.lastIndexOf("$");
  }
  return prose.includes("$$");
}
