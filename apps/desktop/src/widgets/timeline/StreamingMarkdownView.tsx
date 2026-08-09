/**
 * Stateless streaming Markdown view: parse agent text into safe React nodes.
 */

import type { ReactNode } from "react";
import {
  parseStreamingMarkdown,
  type BlockNode,
  type InlineNode,
} from "./streamingMarkdown";

export type StreamingMarkdownViewProps = {
  /** Full accumulated agent text. */
  text: string;
  /** Whether to show a streaming cursor at the end. */
  showCursor?: boolean;
};

/**
 * Extract plain text from inline nodes for stable list item keys.
 * @param nodes Inline nodes.
 */
function inlinePlain(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text" || n.type === "code") {
        return n.text;
      }
      if (n.type === "link") {
        return inlinePlain(n.children);
      }
      if (n.type === "strong" || n.type === "em") {
        return inlinePlain(n.children);
      }
      return "";
    })
    .join("")
    .slice(0, 48);
}

/**
 * Render an inline node tree.
 * @param nodes Inline nodes.
 * @param keyPrefix React key prefix.
 */
function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") {
      return <span key={key}>{node.text}</span>;
    }
    if (node.type === "code") {
      return (
        <code key={key} className="md-inline-code">
          {node.text}
        </code>
      );
    }
    if (node.type === "strong") {
      return <strong key={key}>{renderInline(node.children, key)}</strong>;
    }
    if (node.type === "em") {
      return <em key={key}>{renderInline(node.children, key)}</em>;
    }
    return (
      <a
        key={key}
        className="md-link"
        href={node.href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {renderInline(node.children, key)}
      </a>
    );
  });
}

/**
 * Render a single block.
 * @param block Block node.
 * @param index Index.
 */
function renderBlock(block: BlockNode, index: number): ReactNode {
  if (block.type === "blank") {
    return <div key={`b-${index}`} className="md-blank" />;
  }
  if (block.type === "heading") {
    const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
    return (
      <Tag key={`h-${index}`} className={`md-h md-h${block.level}`}>
        {renderInline(block.children, `h${index}`)}
      </Tag>
    );
  }
  if (block.type === "code_block") {
    return (
      <pre
        key={`c-${index}`}
        className={block.closed ? "md-pre" : "md-pre md-pre-open"}
        data-lang={block.lang || undefined}
      >
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag key={`l-${index}`} className="md-list">
        {block.items.map((item, itemIndex) => {
          const itemKey = `li-${index}-${inlinePlain(item)}-${itemIndex}`;
          return (
            <li key={itemKey}>
              {renderInline(item, itemKey)}
            </li>
          );
        })}
      </ListTag>
    );
  }
  return (
    <p key={`p-${index}`} className="md-p">
      {renderInline(block.children, `p${index}`)}
    </p>
  );
}

/**
 * Streaming Markdown view.
 * @param props text + optional cursor.
 */
export function StreamingMarkdownView(props: StreamingMarkdownViewProps) {
  const { text, showCursor } = props;
  const blocks = parseStreamingMarkdown(text);

  return (
    <div className="md-root">
      {blocks.map((block, index) => renderBlock(block, index))}
      {showCursor ? <span className="md-cursor">▌</span> : null}
    </div>
  );
}
