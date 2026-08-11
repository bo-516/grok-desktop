/**
 * Fenced Markdown code block with syntax highlighting.
 *
 * Split out of StreamingMarkdownView because highlighting is async: the element
 * map there stays a stable module constant (remounting it would restart every
 * block mid-stream), while this widget owns the tokenize lifecycle per fence.
 * Chrome still comes from `md-pre` on the surrounding <pre>; this only replaces
 * the text nodes inside <code> with colored runs.
 */

import { useMemo, type HTMLAttributes, type ReactNode } from "react";
import { flattenCodeLines } from "@/lib/codeHighlight";
import { languageForFenceClass } from "@/lib/codeHighlightLanguages";
import { CodeLineView, useCodeHighlight } from "@/widgets/shared";

export type MarkdownCodeWidgetProps = HTMLAttributes<HTMLElement> & {
  /** Fence class from the Markdown pipeline, e.g. "language-tsx". */
  className?: string;
  /** Rendered code content; a string for every fence Streamdown produces. */
  children?: ReactNode;
};

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
  const lines = useCodeHighlight(text, language);
  /*
   * Flattened, not per-line wrappers: `md-pre` sets whitespace-pre on the
   * <code>, so explicit "\n" runs lay the block out exactly as the plain-text
   * fallback did. Extra per-line elements would change selection and copy.
   */
  const tokens = useMemo(
    () => (lines ? flattenCodeLines(lines) : undefined),
    [lines],
  );

  if (!tokens) {
    return (
      <code {...rest} className={className}>
        {children}
      </code>
    );
  }
  return (
    <code {...rest} className={className}>
      <CodeLineView text={text} tokens={tokens} />
    </code>
  );
}
