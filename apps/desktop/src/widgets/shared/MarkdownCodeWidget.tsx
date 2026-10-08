/**
 * Fenced Markdown code block with syntax highlighting.
 *
 * Shared by timeline (`md-pre`) and document preview (`doc-pre`): highlighting
 * is async, so the Streamdown element map stays a stable constant while this
 * widget owns the tokenize lifecycle per fence. Chrome lives on the surrounding
 * <pre>; this only replaces text nodes inside <code> with colored runs.
 */

import { useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { flattenCodeLines } from "@/lib/codeHighlight";
import { languageForFenceClass } from "@/lib/codeHighlightLanguages";
// Sibling modules, not the `@/widgets/shared` barrel: the barrel re-exports
// this file, and that cycle breaks once code-split chunks (preview doc)
// import MarkdownCodeWidget through the barrel.
import {
  CodeHighlightVisibilityContext,
  type CodeHighlightVisibility,
} from "./codeHighlightVisibility";
import { CodeLineView } from "./stateless/CodeLineView";
import { useCodeHighlight } from "./useCodeHighlight";

export type MarkdownCodeWidgetProps = HTMLAttributes<HTMLElement> & {
  /** Fence class from the Markdown pipeline, e.g. "language-tsx". */
  className?: string;
  /** Rendered code content; a string for every fence Streamdown produces. */
  children?: ReactNode;
};

/**
 * DOM flag for a timeline fence. Preview (immediate) omits it so document
 * markup stays unchanged. Deferred means Shiki has not been asked yet.
 * @param visibility Scope from the nearest provider, or immediate.
 * @param highlight True when tokenization is allowed to run.
 */
function codeHighlightFlag(
  visibility: CodeHighlightVisibility,
  highlight: boolean,
): "on" | "deferred" | undefined {
  if (visibility === "immediate") {
    return undefined;
  }
  if (highlight) {
    return "on";
  }
  return "deferred";
}

/**
 * Flatten a fence's children back to source text.
 * @param children Children Streamdown passes to the `code` element.
 * @returns The code as plain text, or "" when the children are not pure text
 *   (nested elements from a rehype plugin) — "" disables highlighting so the
 *   original children render untouched rather than being replaced by a
 *   lossy reconstruction.
 */
function codeTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children) && children.every((c) => typeof c === "string")) {
    return children.join("");
  }
  return "";
}

/**
 * Render one fenced block, highlighted when the grammar and tokens are ready.
 * @param props Fence class (selects the grammar), code children, and any DOM
 *   props the Markdown pipeline attached.
 */
export function MarkdownCodeWidget(props: MarkdownCodeWidgetProps) {
  const { className, children, ...rest } = props;
  const text = codeTextFromChildren(children);
  const language = useMemo(
    () => languageForFenceClass(className),
    [className],
  );
  /**
   * Timeline rows defer off-screen fences. Immediate (the default) keeps
   * preview / doc highlighting on the first paint. Passing "" disables
   * useCodeHighlight without unmounting the plain source text.
   */
  const visibility = useContext(CodeHighlightVisibilityContext);
  const highlight = visibility !== "deferred";
  const lines = useCodeHighlight(highlight ? text : "", language);
  /** Omitted outside the timeline so preview markup does not grow a flag. */
  const highlightFlag = codeHighlightFlag(visibility, highlight);
  /*
   * Flattened, not per-line wrappers: `md-pre` / `doc-pre` set pre-wrap on
   * the <code> (via code-wrap), so explicit "\n" runs still lay the block
   * out like the plain-text fallback while long lines wrap. Extra per-line
   * elements would change selection and copy.
   */
  const tokens = useMemo(
    () => (lines ? flattenCodeLines(lines) : undefined),
    [lines],
  );

  if (!tokens) {
    return (
      <code {...rest} className={className} data-code-highlight={highlightFlag}>
        {children}
      </code>
    );
  }
  return (
    <code {...rest} className={className} data-code-highlight={highlightFlag}>
      <CodeLineView text={text} tokens={tokens} />
    </code>
  );
}
