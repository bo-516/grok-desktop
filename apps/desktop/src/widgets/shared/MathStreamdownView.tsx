/**
 * Streamdown with KaTeX math (`@streamdown/math` = remark-math + rehype-katex).
 *
 * Purpose: the only module that statically imports `@streamdown/math`, `katex`
 * and `katex.min.css`. It is loaded on demand through
 * {@link LazyMathStreamdownView} (see lazyMathStreamdown.ts) once a message or
 * document actually contains math delimiters, so KaTeX (~270 kB minified JS +
 * 23 kB CSS) stays out of the startup bundle.
 *
 * Boundary: never import this file directly from feature code — that would
 * pull KaTeX back into whichever chunk imports it. Use the lazy export from
 * `@/widgets/shared` instead. Stateless: same props → same render.
 */

import { Streamdown, type StreamdownProps } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
// KaTeX layout metrics (fonts, spacing). Text color inherits `currentColor`
// from `.md-root` / doc chrome; errorColor maps parse failures to the danger token.
import "katex/dist/katex.min.css";

/**
 * Which remark-math flavour to render with.
 * - `agent`: agent answers; LLMs emit `$…$` for inline math.
 * - `doc`: workspace Markdown files; `$$` only so currency / shell `$` stays text.
 */
export type MathStreamdownVariant = "agent" | "doc";

export type MathStreamdownViewProps = Omit<StreamdownProps, "plugins"> & {
  /**
   * Math flavour; must match the `singleDollar` option the caller used with
   * hasMathDelimiters, or detection and rendering disagree.
   */
  mathVariant: MathStreamdownVariant;
};

/**
 * Agent-answer math plugin. singleDollarTextMath: LLMs almost always emit
 * `$…$` for inline math; fenced code stays out of remark-math so `$HOME` /
 * shell dollars inside fences are not rewritten. errorColor must be a
 * defineColor token (no hex in TSX).
 */
const agentMath = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: "var(--color-danger)",
});

/**
 * Document math plugin: display `$$` only (no single-`$` rewrite of currency /
 * shell). Input is the raw file string — not the agent math pipeline.
 */
const docMath = createMathPlugin({
  singleDollarTextMath: false,
  errorColor: "var(--color-danger)",
});

/**
 * Stable plugin maps per variant — module-level so Streamdown's plugin memo
 * does not rebuild the unified processor on every render / stream tick.
 */
const mathPluginsByVariant: Record<
  MathStreamdownVariant,
  NonNullable<StreamdownProps["plugins"]>
> = {
  agent: { math: agentMath },
  doc: { math: docMath },
};

/**
 * Render Streamdown with the KaTeX plugin for `mathVariant`; every other prop
 * is forwarded untouched so the caller keeps owning mode / components / links.
 * @param props Streamdown props (minus `plugins`) plus the math flavour.
 * @returns The Streamdown tree with math rendered by KaTeX.
 */
export function MathStreamdownView(props: MathStreamdownViewProps) {
  const { mathVariant, ...streamdownProps } = props;
  return (
    <Streamdown
      {...streamdownProps}
      plugins={mathPluginsByVariant[mathVariant]}
    />
  );
}
