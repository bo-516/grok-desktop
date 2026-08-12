/**
 * Stateless streaming Markdown view via Streamdown (GFM + incomplete-block tolerant).
 * Custom components map to app `md-*` Uno shortcuts so colors stay on defineColor tokens.
 *
 * Math pipeline (two stages — both required for agent textbook answers):
 * 1. {@link normalizeAgentMath} — bare `(\sqrt{…})` / multi-line `[ … ]` /
 *    even `\(...\)` / `\[…\]` → **only** `$…$` / `$$…$$`.
 *    remark-math@6 (used by @streamdown/math) does not parse backslash
 *    delimiters; CommonMark then eats `\` and leaves raw `[` soup on screen.
 * 2. `@streamdown/math` (remark-math + KaTeX) renders `$…$` / `$$…$$`.
 *
 * Links open outside the shell via {@link openExternalUrl} (Wails system browser /
 * Vite new tab) — bare target=_blank is a no-op inside the desktop webview.
 *
 * Thematic breaks (`---` / `***` / `___` → `<hr class="md-hr">`): currently
 * `hidden` on the `md-hr` Uno shortcut so agent separators do not read as shell
 * chrome. If that later feels wrong (e.g. real section rules are wanted), drop
 * only the `hidden` token from `md-hr` in `uno/shortcuts.timeline.ts`.
 */

import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { Streamdown, type Components } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import cs from "classnames";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { normalizeAgentMath } from "@/lib/normalizeAgentMath";
import { MarkdownCodeWidget } from "./MarkdownCodeWidget";
// KaTeX layout metrics (fonts, spacing). Text color inherits `currentColor` from
// `.md-root`; errorColor below maps parse failures to the app danger token.
import "katex/dist/katex.min.css";

export type StreamingMarkdownViewProps = {
  /** Full accumulated agent text (may be mid-stream / incomplete Markdown). */
  text: string;
  /** Whether to show a streaming caret after the last rendered content. */
  showCursor?: boolean;
};

/**
 * Streamdown math plugin (KaTeX).
 * singleDollarTextMath: LLMs almost always emit `$…$` for inline math; fenced
 * code blocks stay out of remark-math so `$HOME` / shell dollars inside fences
 * are not rewritten. errorColor must be a defineColor token (no hex in TSX).
 */
const streamdownMath = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: "var(--color-danger)",
});

/** Stable plugins map — avoid reallocating on every StreamingMarkdownView render. */
const streamdownPlugins = { math: streamdownMath };

/**
 * Common props Streamdown passes into custom element renderers.
 * `node` is the mdast/hast node and must not be spread onto the DOM.
 */
type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
  children?: ReactNode;
  href?: string;
  src?: string;
  alt?: string;
};

/**
 * Strip the AST `node` before spreading onto DOM elements.
 * @param props Renderer props from Streamdown components.
 * @returns Props safe to spread onto HTML elements (no `node` field).
 */
function withoutNode(props: MdElementProps): Omit<MdElementProps, "node"> {
  const { node: _node, ...rest } = props;
  return rest;
}

/**
 * Merge our `md-*` class with any class Streamdown may pass.
 * @param base App shortcut class(es).
 * @param className Optional class from the pipeline.
 */
function mdClass(base: string, className?: string): string {
  return cs(base, className);
}

/**
 * Stable element map: GFM structure with app chrome classes (tables, lists, code, links).
 * Overrides Streamdown defaults so we do not depend on its Tailwind / shadcn utility classes.
 */
const mdComponents: Components = {
  p: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <p {...rest} className={mdClass("md-p", className)} />;
  },
  h1: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h1 {...rest} className={mdClass("md-h md-h1", className)} />;
  },
  h2: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h2 {...rest} className={mdClass("md-h md-h2", className)} />;
  },
  h3: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h3 {...rest} className={mdClass("md-h md-h3", className)} />;
  },
  h4: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h4 {...rest} className={mdClass("md-h md-h4", className)} />;
  },
  h5: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h5 {...rest} className={mdClass("md-h md-h4", className)} />;
  },
  h6: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <h6 {...rest} className={mdClass("md-h md-h4", className)} />;
  },
  ul: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <ul {...rest} className={mdClass("md-list", className)} />;
  },
  ol: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return (
      <ol {...rest} className={mdClass("md-list md-list-ordered", className)} />
    );
  },
  li: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <li {...rest} className={className} />;
  },
  a: (props) => {
    const { className, href, onClick, ...rest } = withoutNode(
      props as MdElementProps,
    );
    /** Raw href from markdown; may be unsafe — open path re-validates. */
    const rawHref = typeof href === "string" ? href : undefined;
    return (
      <a
        {...rest}
        href={rawHref}
        className={mdClass("md-link", className)}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (typeof onClick === "function") {
            onClick(event);
          }
          if (event.defaultPrevented || !rawHref) {
            return;
          }
          // Always take over primary click: webview target=_blank does not open
          // the system browser; keep href for a11y / copy-link context menu.
          event.preventDefault();
          void openExternalUrl(rawHref);
        }}
      />
    );
  },
  strong: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <strong {...rest} className={className} />;
  },
  em: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <em {...rest} className={className} />;
  },
  del: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <del {...rest} className={mdClass("md-del", className)} />;
  },
  blockquote: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return (
      <blockquote {...rest} className={mdClass("md-blockquote", className)} />
    );
  },
  hr: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <hr {...rest} className={mdClass("md-hr", className)} />;
  },
  pre: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <pre {...rest} className={mdClass("md-pre", className)} />;
  },
  code: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    const isFenced =
      typeof className === "string" && className.includes("language-");
    // Only fences get highlighted: inline code is prose-sized chrome, and
    // tokenizing a bare word out of context colors it wrong more often than right.
    if (isFenced) {
      return <MarkdownCodeWidget {...rest} className={className} />;
    }
    return <code {...rest} className={cs("md-inline-code", className)} />;
  },
  table: (props) => {
    const { className, children, ...rest } = withoutNode(
      props as MdElementProps,
    );
    return (
      <div className="md-table-wrap">
        <table {...rest} className={mdClass("md-table", className)}>
          {children}
        </table>
      </div>
    );
  },
  thead: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <thead {...rest} className={mdClass("md-thead", className)} />;
  },
  tbody: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <tbody {...rest} className={className} />;
  },
  tr: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <tr {...rest} className={mdClass("md-tr", className)} />;
  },
  th: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <th {...rest} className={mdClass("md-th", className)} />;
  },
  td: (props) => {
    const { className, ...rest } = withoutNode(props as MdElementProps);
    return <td {...rest} className={mdClass("md-td", className)} />;
  },
  img: (props) => {
    const { className, alt, ...rest } = withoutNode(props as MdElementProps);
    return (
      <img
        {...rest}
        alt={typeof alt === "string" ? alt : ""}
        className={mdClass("md-img", className)}
      />
    );
  },
};

/**
 * Streaming Markdown view (Streamdown).
 * @param props text + optional end cursor while the agent is still streaming.
 */
export function StreamingMarkdownView(props: StreamingMarkdownViewProps) {
  const { text, showCursor } = props;
  // Bare () / [] / \( \) / \[ \] → $ / $$ only (remark-math v6). Then KaTeX.
  // Incomplete stream ticks leave open wrappers alone.
  const mathReady = normalizeAgentMath(text);

  return (
    /* data-streaming drives the caret (base.css): it is an ::after on the last
     * rendered block, because a sibling <span> would always wrap to its own
     * line under the Streamdown wrapper div. */
    <div className="md-root" data-streaming={showCursor ? "true" : undefined}>
      <Streamdown
        className="md-streamdown"
        mode={showCursor ? "streaming" : "static"}
        parseIncompleteMarkdown
        controls={false}
        lineNumbers={false}
        linkSafety={{ enabled: false }}
        plugins={streamdownPlugins}
        components={mdComponents}
      >
        {mathReady}
      </Streamdown>
    </div>
  );
}
