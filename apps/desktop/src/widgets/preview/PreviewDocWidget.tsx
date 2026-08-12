/**
 * Stateful rendered-document body for the preview drawer.
 * Owns KaTeX plugin + DocRenderContext; Streamdown element map lives in
 * previewDocComponents (module-stable). Disk Markdown is fed as-authored:
 * no agent-output math rewrite (timeline-only path); `[…]` stays literal.
 */

import { useMemo, useRef } from "react";
import { Streamdown } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { useCopyFeedback } from "@/widgets/shared";
import {
  DocRenderContext,
  docComponents,
  type DocRenderContextValue,
} from "./previewDocComponents";
import { docRehypePlugins } from "./docRehypeSafety";
import { PreviewDocView } from "./PreviewDocView";
// KaTeX layout metrics; text color inherits from doc chrome tokens.
import "katex/dist/katex.min.css";

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
 * Streamdown math for documents: display `$$` only (no single-`$` rewrite of
 * currency / shell). Input is the raw file string — not the agent math pipeline.
 */
const docMath = createMathPlugin({
  singleDollarTextMath: false,
  errorColor: "var(--color-danger)",
});

/** Stable plugins map — avoid reallocating on every PreviewDocWidget render. */
const docPlugins = { math: docMath };

/**
 * Render one workspace Markdown file as a static document (GFM + doc typography).
 * @param props Path (link base), content, truncation flag, in-drawer open handler.
 */
export function PreviewDocWidget(props: PreviewDocWidgetProps) {
  const { path, content, truncated, onOpenFile } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { copiedKey, copy } = useCopyFeedback();

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

  return (
    <DocRenderContext.Provider value={ctx}>
      <div ref={rootRef} className="flex flex-col flex-1 min-h-0">
        <PreviewDocView truncated={truncated}>
          {/*
            Static mode + no incomplete parsing: disk files are complete.
            linkSafety off — we own the click matrix (external / anchor / file).
            Raw content is passed through as-authored (no agent math rewrite).
          */}
          <Streamdown
            className="doc-flow"
            mode="static"
            parseIncompleteMarkdown={false}
            controls={false}
            lineNumbers={false}
            linkSafety={{ enabled: false }}
            // Replace default rehype-harden so relative workspace links survive.
            rehypePlugins={docRehypePlugins}
            // Identity: do not rewrite relative hrefs against the page origin.
            urlTransform={(url) => url}
            plugins={docPlugins}
            components={docComponents}
          >
            {content}
          </Streamdown>
        </PreviewDocView>
      </div>
    </DocRenderContext.Provider>
  );
}
