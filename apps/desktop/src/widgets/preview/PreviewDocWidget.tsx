/**
 * Stateful rendered-document body for the preview drawer.
 * Owns DocRenderContext; Streamdown element map lives in previewDocComponents
 * (module-stable). Disk Markdown is fed as-authored: no agent-output math
 * rewrite (timeline-only path); `[…]` stays literal.
 * KaTeX is code-split: only a document containing `$$` renders the lazily
 * loaded `LazyMathStreamdownView` (doc variant: display `$$` only, no
 * single-`$` rewrite of currency / shell), with the plain render as fallback.
 */

import { Suspense, useMemo, useRef } from "react";
import { Streamdown } from "streamdown";
import { hasMathDelimiters } from "@/lib/mathDelimiters";
import {
  LazyMathStreamdownView,
  useCopyFeedback,
  type MathStreamdownViewProps,
} from "@/widgets/shared";
import {
  DocRenderContext,
  docComponents,
  type DocRenderContextValue,
} from "./previewDocComponents";
import { docRehypePlugins } from "./docRehypeSafety";
import { PreviewDocView } from "./PreviewDocView";

export type PreviewDocWidgetProps = {
  /** Absolute path of the open document (relative link resolution base). */
  path: string;
  /** Full file text (may already be bridge-truncated at 1MB). */
  content: string;
  /** When true, show the bridge truncation banner. */
  truncated?: boolean;
  /**
   * Open another workspace path in the same preview drawer.
   * Used for relative Markdown links (`./x.md`, `docs/a.md`).
   */
  onOpenFile: (path: string) => void;
};

/**
 * Identity URL transform: do not rewrite relative hrefs against the page
 * origin, so in-drawer workspace links keep their file-relative form.
 * @param url Href/src exactly as authored in the document.
 * @returns The same string.
 */
function keepUrl(url: string): string {
  return url;
}

/**
 * Streamdown props shared by the plain and the math render (module-stable).
 * Static mode + no incomplete parsing: disk files are complete. linkSafety
 * off — we own the click matrix (external / anchor / file). docRehypePlugins
 * replaces default rehype-harden so relative workspace links survive.
 */
const docMarkdownProps = {
  className: "doc-flow",
  mode: "static",
  parseIncompleteMarkdown: false,
  controls: false,
  lineNumbers: false,
  linkSafety: { enabled: false },
  rehypePlugins: docRehypePlugins,
  urlTransform: keepUrl,
  components: docComponents,
} satisfies Omit<MathStreamdownViewProps, "mathVariant" | "children">;

/**
 * Render one workspace Markdown file as a static document (GFM + doc typography).
 * @param props Path (link base), content, truncation flag, in-drawer open handler.
 */
export function PreviewDocWidget(props: PreviewDocWidgetProps) {
  const { path, content, truncated, onOpenFile } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { copiedKey, copy } = useCopyFeedback();
  /** Gate for the KaTeX chunk; doc flavour only treats `$$` as math. */
  const needsMath = hasMathDelimiters(content, { singleDollar: false });

  const ctx = useMemo<DocRenderContextValue>(
    () => ({
      path,
      onOpenFile,
      rootRef,
      copy,
      copiedKey,
    }),
    [path, onOpenFile, copy, copiedKey],
  );

  /** Plain render: the whole body when math-free, the fallback otherwise. */
  const plain = <Streamdown {...docMarkdownProps}>{content}</Streamdown>;

  return (
    <DocRenderContext.Provider value={ctx}>
      <div ref={rootRef} className="flex flex-col flex-1 min-h-0">
        <PreviewDocView truncated={truncated}>
          {/* Raw content is passed through as-authored (no agent math rewrite). */}
          {needsMath ? (
            <Suspense fallback={plain}>
              <LazyMathStreamdownView {...docMarkdownProps} mathVariant="doc">
                {content}
              </LazyMathStreamdownView>
            </Suspense>
          ) : (
            plain
          )}
        </PreviewDocView>
      </div>
    </DocRenderContext.Provider>
  );
}
