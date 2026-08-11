/**
 * Normalize agent “almost-LaTeX” into delimiters that remark-math v6 + KaTeX accept.
 *
 * Critical constraint: `@streamdown/math` uses remark-math@6, which only parses
 * `$…$` / `$$…$$`. It does **not** parse `\(...\)` / `\[…\]`. Those backslash
 * forms are treated as CommonMark escapes and collapse to bare `(…)` / `[…]`,
 * which is exactly the “一屏反斜杠” failure mode in agent math screenshots.
 *
 * This normalizer therefore emits **only dollar delimiters**:
 *
 *   (\sqrt{r^{2}-h^{2}})          →  $\sqrt{r^{2}-h^{2}}$
 *   \( … \)                       →  $…$
 *   \[ … \] / [ … ] on own lines  →  a `$$` fence block (see below)
 *
 * Display math must be a **fence block**, not `$$…$$` on one line:
 *   - `$$x$$` inside a line is *text* math (`math-inline`) — rehype-katex renders
 *     it with `displayMode:false`, so a centred equation comes out inline-sized.
 *   - `$$` alone on a line opens *flow* math (`math-display`), which is what a
 *     display equation needs. A flow fence may interrupt a paragraph directly,
 *     so no blank line has to be inserted around it.
 *
 * Two rules keep those fences from corrupting the rest of the answer:
 * 1. **Indent is preserved.** A `\[…\]` written inside a list item is indented;
 *    re-emitting its closing fence at column 0 drops out of the item, leaving an
 *    unclosed fence. Open fence, body and close fence all carry the indent of
 *    the line the block started on, and whitespace-only body lines are dropped
 *    (a blank line inside a list ends the item and orphans the closer).
 * 2. **{@link guardDisplayFences}** is a last-resort net: an unpaired `$$` fence
 *    line swallows every following block as one giant formula — the whole-screen
 *    salmon KaTeX error. Any fence left open is closed, or neutralized to a
 *    literal `$$` when the text after it has clearly moved on to other prose.
 *
 * Boundaries:
 * - Leaves fenced code blocks and already-correct `$` / `$$` math untouched.
 * - Skips Markdown links `[label](url)`.
 * - Only rewrites wrappers whose interior “looks like LaTeX” (TeX command or
 *   `_{` / `^{`). Plain `(h)` / `(推荐)` stay as text.
 * - Pure function: same input → same output; safe on every stream tick.
 */

/** Placeholder prefix; rare private-use chars so it cannot collide with agent text. */
const PH = "MATH";

/** A line that is nothing but a `$$` fence (optionally indented). */
const FENCE_LINE = /^([ \t]*)\$\$[ \t]*$/;

/** Opening/closing line of a Markdown code fence. */
const CODE_FENCE_LINE = /^[ \t]*(?:```|~~~)/;

/**
 * True when `s` contains a TeX control word (`\frac`, `\pi`, `\text`, …).
 * Strongest signal that a wrapper was meant as math (not prose or algebra grouping).
 * @param s Interior of a candidate wrapper (no surrounding delimiters).
 */
export function hasTexCommand(s: string): boolean {
  return /\\[a-zA-Z]+/.test(s);
}

/**
 * True when `s` contains TeX-like tokens that should enter math mode.
 * @param s Interior of a candidate wrapper (no surrounding delimiters).
 */
export function looksLikeLatex(s: string): boolean {
  const t = s.trim();
  if (!t) {
    return false;
  }
  // Control words: \frac \pi \text \sqrt \cdot \times \int …
  if (hasTexCommand(t)) {
    return true;
  }
  // Braced super/subscripts: x^{2}, S_{\text{…}} — enough for [ … ] blocks.
  if (/[_^]\{/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Build a flow-math (`math-display`) fence carrying the caller's indent.
 *
 * Every emitted line gets the same indent so the block stays inside whatever
 * container it started in, and blank body lines are dropped so the fence cannot
 * be cut in half by a paragraph/list break.
 *
 * @param indent Leading whitespace of the line the source block started on.
 * @param inner Formula body without delimiters.
 * @returns `$$` fence block, or `""` when the body was empty.
 */
function asDisplayFence(indent: string, inner: string): string {
  const lines = inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  const body = lines.map((line) => `${indent}${line}`).join("\n");
  return `${indent}$$\n${body}\n${indent}$$`;
}

/**
 * Wrap interior as inline math (`$…$`).
 * Newlines are collapsed: text math cannot span a blank line, and a wrapped
 * inline formula reads as one token anyway.
 * @param inner Formula body without delimiters.
 */
function asInlineMath(inner: string): string {
  return `$${inner.trim().replace(/\s*\n\s*/g, " ")}$`;
}

/**
 * Wrap interior as `$$…$$` on a single line (text math with display intent).
 * Used only mid-line, where a fence block is not available.
 * @param inner Formula body without delimiters.
 */
function asInlineDisplayMath(inner: string): string {
  return `$$${inner.trim().replace(/\s*\n\s*/g, " ")}$$`;
}

/**
 * Replace non-overlapping matches of `re` with placeholders; record originals.
 * @param text Source string.
 * @param re Global regex; must not rely on lastIndex across calls.
 * @param bag Out-array of replaced slices (push order = placeholder index).
 */
function stashMatches(text: string, re: RegExp, bag: string[]): string {
  return text.replace(re, (m) => {
    const i = bag.length;
    bag.push(m);
    return `${PH}${i}`;
  });
}

/**
 * Restore placeholders written by {@link stashMatches}.
 * @param text Text with placeholders.
 * @param bag Original slices in push order.
 */
function unstash(text: string, bag: string[]): string {
  return text.replace(
    new RegExp(`${PH}(\\d+)`, "g"),
    (_, n: string) => bag[Number(n)] ?? "",
  );
}

/**
 * Hide already-correct dollar math so later wrapper rules cannot double-wrap it.
 * @param text Source string.
 * @param bag Placeholder bag shared with {@link unstash}.
 */
function stashDollarMath(text: string, bag: string[]): string {
  // Fence blocks first (multi-line), then same-line $$…$$, then inline $…$.
  let s = stashMatches(text, /^[ \t]*\$\$[ \t]*\n[\s\S]*?\n[ \t]*\$\$[ \t]*$/gm, bag);
  s = stashMatches(s, /\$\$[^\n]+?\$\$/g, bag);
  s = stashMatches(s, /(?<!\$)\$(?!\$)(?:\\\$|[^$\n])+?\$(?!\$)/g, bag);
  return s;
}

/**
 * Close or neutralize a `$$` fence that never got a partner.
 *
 * An unpaired opener makes remark-math read every following heading, list and
 * paragraph as one formula; KaTeX then fails and dumps the raw Markdown in
 * `errorColor`. Two outcomes, chosen by what follows the opener:
 * - tail still looks like one formula (no blank line) → append the closing
 *   fence, which is also the right call mid-stream;
 * - tail has moved on to other blocks → escape the opener to a literal `$$`.
 *
 * @param text Normalized Markdown, still holding stash placeholders.
 * @returns Text whose `$$` fences are guaranteed to be balanced.
 */
function guardDisplayFences(text: string): string {
  const lines = text.split("\n");
  let inCode = false;
  let openAt = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (CODE_FENCE_LINE.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !FENCE_LINE.test(line)) {
      continue;
    }
    openAt = openAt < 0 ? i : -1;
  }
  if (openAt < 0) {
    return text;
  }
  const indent = FENCE_LINE.exec(lines[openAt] ?? "")?.[1] ?? "";
  const runaway = lines.slice(openAt + 1).some((line) => line.trim() === "");
  if (runaway) {
    lines[openAt] = `${indent}\\$\\$`;
    return lines.join("\n");
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n${indent}$$`;
}

/**
 * Convert agent math wrappers to `$` / `$$` delimiters for remark-math / KaTeX.
 * @param text Full accumulated agent Markdown (may be mid-stream / incomplete).
 * @returns Text safe to feed Streamdown; display blocks come out as `$$` fences.
 */
export function normalizeAgentMath(text: string): string {
  // Fast path: nothing that could be TeX and no fence to balance — avoid
  // scanning every plain bubble.
  if (
    !text ||
    (!text.includes("\\") &&
      !text.includes("$$") &&
      !text.includes("^{") &&
      !text.includes("_{"))
  ) {
    return text;
  }

  const bag: string[] = [];
  let s = text;

  // 1) Protect fenced code (``` / ~~~), including incomplete closing while streaming.
  s = stashMatches(
    s,
    /^(?:```|~~~)[^\n]*\n[\s\S]*?(?:^(?:```|~~~)[ \t]*$|$)/gm,
    bag,
  );

  // 2) Protect math that is already on the only delimiters remark-math v6 accepts.
  s = stashDollarMath(s, bag);

  // 3) `\[ … \]` spanning whole lines → display fence at the source indent.
  s = s.replace(
    /^([ \t]*)\\\[[ \t]*\n([\s\S]*?)\n[ \t]*\\\][ \t]*$/gm,
    (full, indent: string, inner: string) => asDisplayFence(indent, inner) || full,
  );
  // 4) `\[ … \]` alone on one line → still a display equation, so still a fence.
  s = s.replace(
    /^([ \t]*)\\\[[ \t]*(.+?)[ \t]*\\\][ \t]*$/gm,
    (full, indent: string, inner: string) => asDisplayFence(indent, inner) || full,
  );
  // 5) Leftover `\[ … \]` mid-line, and every `\( … \)`.
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_full, inner: string) =>
    asInlineDisplayMath(inner),
  );
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_full, inner: string) =>
    asInlineMath(inner),
  );

  // Newly created dollars must not be re-processed by the bare-wrapper steps.
  s = stashDollarMath(s, bag);

  // 6) Multi-line bare bracket display blocks (Chinese textbook agent style):
  //      [\n  latex…\n]
  s = s.replace(
    /^([ \t]*)\[[ \t]*\n([\s\S]*?)\n[ \t]*\][ \t]*$/gm,
    (full, indent: string, inner: string) => {
      if (!looksLikeLatex(inner)) {
        return full;
      }
      return asDisplayFence(indent, inner) || full;
    },
  );

  // 7) Same-line [ latex ]. A whole-line bracket is a display equation; one
  //    embedded in a sentence stays inline. Markdown links [label](url) are skipped.
  s = s.replace(
    /^([ \t]*)\[([^\]\n]+)][ \t]*$/gm,
    (full, indent: string, inner: string) => {
      if (!looksLikeLatex(inner)) {
        return full;
      }
      return asDisplayFence(indent, inner) || full;
    },
  );
  s = s.replace(/\[([^\]\n]+)](?!\()/g, (full, inner: string) => {
    if (!looksLikeLatex(inner)) {
      return full;
    }
    const trimmed = inner.trim();
    // Prefer the display form when long or relational (typical equation lines).
    if (trimmed.length > 48 || /[=≈≠≤≥]/.test(trimmed)) {
      return asInlineDisplayMath(trimmed);
    }
    return asInlineMath(trimmed);
  });

  // 8) Parentheses used as inline math wrappers: (\sqrt{…}), (\pi r^{2})
  // Require a real TeX command — not mere r^{2} — so algebraic grouping inside
  // an already-converted display formula, e.g. \pi(r^{2}-h^{2}), stays intact.
  s = s.replace(/\(([^()\n]+)\)/g, (full, inner: string) => {
    if (!hasTexCommand(inner)) {
      return full;
    }
    return asInlineMath(inner);
  });

  // Guard before unstash: every fence this function emitted, and every balanced
  // pair the agent already wrote, is a placeholder by now — so the only `$$`
  // lines still visible are the genuinely unpaired ones.
  return unstash(guardDisplayFences(s), bag);
}
