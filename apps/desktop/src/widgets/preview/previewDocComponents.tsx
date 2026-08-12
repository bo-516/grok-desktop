/**
 * Stable Streamdown element map for document preview (`doc-*` chrome).
 * Module-level so Streamdown does not remount fences on parent re-render.
 * Instance handlers (path, open file, copy, scroll root) come from DocRenderContext.
 */

import {
  createContext,
  useContext,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Components } from "streamdown";
import cs from "classnames";
import { openExternalUrl, sanitizeExternalUrl } from "@/lib/openExternalUrl";
import { resolveDocRelativePath, slugifyHeading } from "@/lib/docLinkPath";
import { MarkdownCodeWidget } from "@/widgets/shared";

/** Instance handlers shared by the stable Streamdown element map. */
export type DocRenderContextValue = {
  /** Open document path (base for relative links). */
  path: string;
  /** In-drawer open for workspace-relative targets. */
  onOpenFile: (path: string) => void;
  /** Scroll root for `#anchor` heading lookup. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Fence / toolbar copy helper. */
  copy: (key: string, text: string) => void;
  /** Active copy flash key, or null. */
  copiedKey: string | null;
};

/** Context providing the open file path + link/copy handlers to element renderers. */
export const DocRenderContext = createContext<DocRenderContextValue | null>(
  null,
);

/**
 * Read the active document render context.
 * @returns Context for the mounted PreviewDocWidget; throws when used outside.
 */
function useDocRender(): DocRenderContextValue {
  const ctx = useContext(DocRenderContext);
  if (!ctx) {
    throw new Error("doc element used outside PreviewDocWidget");
  }
  return ctx;
}

/** Common props Streamdown passes into custom element renderers. */
type DocElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
  children?: ReactNode;
  href?: string;
  src?: string;
  alt?: string;
};

/**
 * Strip the AST `node` before spreading onto DOM elements.
 * @param props Renderer props from Streamdown components.
 */
function withoutNode(props: DocElementProps): Omit<DocElementProps, "node"> {
  const { node: _node, ...rest } = props;
  return rest;
}

/**
 * Merge a `doc-*` class with any class Streamdown may pass.
 * @param base App shortcut class(es).
 * @param className Optional class from the pipeline.
 */
function docClass(base: string, className?: string): string {
  return cs(base, className);
}

/**
 * Flatten React children to plain text for heading slugs / fence copy.
 * @param children Streamdown / React children tree.
 */
function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  if (children && typeof children === "object" && "props" in children) {
    const nested = (children as { props?: { children?: ReactNode } }).props
      ?.children;
    return textFromChildren(nested);
  }
  return "";
}

/**
 * True when an image src is allowed in the document preview.
 * Only http(s) and data: — relative paths degrade to a filename chip.
 * @param src Raw markdown image src.
 */
function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src) {
    return false;
  }
  const t = src.trim().toLowerCase();
  return (
    t.startsWith("https://") ||
    t.startsWith("http://") ||
    t.startsWith("data:")
  );
}

/**
 * Scroll the document root to a heading whose `id` matches the fragment.
 * @param root Document scroll root.
 * @param fragment Hash without `#`, already decoded.
 */
function scrollToAnchor(
  root: HTMLDivElement | null,
  fragment: string,
): void {
  if (!root || !fragment) {
    return;
  }
  const el = root.querySelector(`#${CSS.escape(fragment)}`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

/**
 * Handle a Markdown link click according to the link matrix:
 * external → system browser; #anchor → in-drawer scroll; relative → open file;
 * other schemes → inert (no navigation).
 * @param event Anchor click event (always prevented for controlled handling).
 * @param rawHref Href attribute from the markdown pipeline.
 * @param ctx Active document render context.
 */
function handleDocLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  rawHref: string | undefined,
  ctx: DocRenderContextValue,
): void {
  if (!rawHref) {
    return;
  }
  event.preventDefault();
  const href = rawHref.trim();
  if (!href) {
    return;
  }
  if (href.startsWith("#")) {
    scrollToAnchor(ctx.rootRef.current, decodeURIComponent(href.slice(1)));
    return;
  }
  const external = sanitizeExternalUrl(href);
  if (external) {
    void openExternalUrl(external);
    return;
  }
  // Reject dangerous schemes (javascript:, file:, etc.) — leave as inert text.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    return;
  }
  const resolved = resolveDocRelativePath(ctx.path, href);
  ctx.onOpenFile(resolved);
}

/** Stable heading factory — id from visible text for `#anchor` scroll. */
function makeHeading(
  Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  extra: string,
) {
  function DocHeading(props: DocElementProps) {
    const { className, children, ...rest } = withoutNode(props);
    const id = slugifyHeading(textFromChildren(children));
    return (
      <Tag
        {...rest}
        id={id || undefined}
        className={docClass(`doc-h ${extra}`, className)}
      >
        {children}
      </Tag>
    );
  }
  DocHeading.displayName = `DocHeading(${Tag})`;
  return DocHeading;
}

/**
 * Module-stable Streamdown element map with `doc-*` chrome.
 * Closures that need the open file use {@link useDocRender}.
 */
export const docComponents: Components = {
  p: function DocP(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <p {...rest} className={docClass("doc-p", className)} />;
  },
  h1: makeHeading("h1", "doc-h1"),
  h2: makeHeading("h2", "doc-h2"),
  h3: makeHeading("h3", "doc-h3"),
  h4: makeHeading("h4", "doc-h4"),
  h5: makeHeading("h5", "doc-h4"),
  h6: makeHeading("h6", "doc-h4"),
  ul: function DocUl(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <ul {...rest} className={docClass("doc-list", className)} />;
  },
  ol: function DocOl(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return (
      <ol
        {...rest}
        className={docClass("doc-list doc-list-ordered", className)}
      />
    );
  },
  li: function DocLi(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <li {...rest} className={className} />;
  },
  a: function DocA(props) {
    const ctx = useDocRender();
    const { className, href, onClick, children, ...rest } = withoutNode(
      props as DocElementProps,
    );
    const rawHref = typeof href === "string" ? href : undefined;
    const isExternal =
      typeof rawHref === "string" && sanitizeExternalUrl(rawHref) != null;
    const isAnchor =
      typeof rawHref === "string" && rawHref.trim().startsWith("#");
    const isInternal = Boolean(rawHref) && !isExternal && !isAnchor;
    return (
      <a
        {...rest}
        href={rawHref}
        className={docClass(
          isInternal ? "doc-link doc-link-internal" : "doc-link",
          className,
        )}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer noopener" : undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (typeof onClick === "function") {
            onClick(event);
          }
          if (event.defaultPrevented) {
            return;
          }
          handleDocLinkClick(event, rawHref, ctx);
        }}
      >
        {children}
      </a>
    );
  },
  strong: function DocStrong(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <strong {...rest} className={className} />;
  },
  em: function DocEm(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <em {...rest} className={className} />;
  },
  del: function DocDel(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <del {...rest} className={docClass("doc-del", className)} />;
  },
  blockquote: function DocBlockquote(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return (
      <blockquote
        {...rest}
        className={docClass("doc-blockquote", className)}
      />
    );
  },
  hr: function DocHr(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <hr {...rest} className={docClass("doc-hr", className)} />;
  },
  pre: function DocPre(props) {
    const { copy, copiedKey } = useDocRender();
    const { className, children, ...rest } = withoutNode(
      props as DocElementProps,
    );
    const fenceText = textFromChildren(children).replace(/\n$/, "");
    const copyKey = `fence:${fenceText.slice(0, 48)}:${fenceText.length}`;
    return (
      <div className="doc-pre-wrap">
        <pre {...rest} className={docClass("doc-pre", className)}>
          {children}
        </pre>
        {fenceText ? (
          <button
            type="button"
            className="doc-pre-copy"
            onClick={() => copy(copyKey, fenceText)}
            aria-label="Copy code"
            title={copiedKey === copyKey ? "Copied" : "Copy code"}
          >
            {copiedKey === copyKey ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
    );
  },
  code: function DocCode(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    const isFenced =
      typeof className === "string" && className.includes("language-");
    if (isFenced) {
      return <MarkdownCodeWidget {...rest} className={className} />;
    }
    return <code {...rest} className={cs("doc-inline-code", className)} />;
  },
  table: function DocTable(props) {
    const { className, children, ...rest } = withoutNode(
      props as DocElementProps,
    );
    return (
      <div className="doc-table-wrap">
        <table {...rest} className={docClass("doc-table", className)}>
          {children}
        </table>
      </div>
    );
  },
  thead: function DocThead(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <thead {...rest} className={docClass("doc-thead", className)} />;
  },
  tbody: function DocTbody(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <tbody {...rest} className={className} />;
  },
  tr: function DocTr(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <tr {...rest} className={docClass("doc-tr", className)} />;
  },
  th: function DocTh(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <th {...rest} className={docClass("doc-th", className)} />;
  },
  td: function DocTd(props) {
    const { className, ...rest } = withoutNode(props as DocElementProps);
    return <td {...rest} className={docClass("doc-td", className)} />;
  },
  img: function DocImg(props) {
    const { className, src, alt, ...rest } = withoutNode(
      props as DocElementProps,
    );
    const rawSrc = typeof src === "string" ? src : undefined;
    if (!isAllowedImageSrc(rawSrc)) {
      const label =
        (typeof alt === "string" && alt) ||
        (rawSrc ? rawSrc.replace(/^.*[/\\]/, "") : "image");
      return (
        <span className="doc-img-missing" title={rawSrc ?? undefined}>
          {label}
        </span>
      );
    }
    return (
      <img
        {...rest}
        src={rawSrc}
        alt={typeof alt === "string" ? alt : ""}
        className={docClass("doc-img", className)}
      />
    );
  },
};
