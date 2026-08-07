/** Pure presentation for a tool-call card; status and content always come from the acp-core patch-merge Map. */

import cs from "classnames";
import type { ToolCallCard } from "@grok-desktop/acp-core";

type ToolCardViewProps = {
  toolCallId: string;
  card: ToolCallCard | undefined;
};

/** Diff fragment inside ACP content (single object or array item). */
type DiffContent = {
  type?: string;
  path?: string;
  oldText?: string;
  newText?: string;
};

/**
 * Displays one ACP tool_call including status, title, and optional diff/text content.
 * @param props When card is missing, show toolCallId so out-of-order tool_call_update cannot produce blank rows.
 * @returns Stateless tool card; content supports a single object, an array, or nested text blocks.
 */
export function ToolCardView(props: ToolCardViewProps) {
  const { card, toolCallId } = props;
  const title = card?.title ?? toolCallId;
  const status = card?.status ?? "pending";
  const badgeClass = cs("badge", {
    "badge-pending": status === "pending" || status === "in_progress",
    "badge-failed": status === "failed",
  });
  const parts = normalizeToolContentParts(card?.content);
  const diffs = parts.filter((p): p is DiffContent => p.type === "diff");
  const textParts = parts
    .map((p) => extractToolText(p))
    .filter((t): t is string => Boolean(t));

  return (
    <div className="item-tool" data-kind="tool" data-tool-id={toolCallId}>
      <div className="tool-head">
        <span>
          {card?.kind ?? "tool"} · {title}
        </span>
        <span className={badgeClass}>{status}</span>
      </div>
      {diffs.map((diff, i) => (
        <div className="mini-diff" key={`diff-${diff.path ?? i}`}>
          {diff.path ? (
            <div className="mini-diff-path">{diff.path}</div>
          ) : null}
          {diff.oldText ? (
            <div className="mini-diff-del">- {diff.oldText}</div>
          ) : null}
          {diff.newText ? (
            <div className="mini-diff-add">+ {diff.newText}</div>
          ) : null}
        </div>
      ))}
      {textParts.length > 0 ? (
        <pre className="tool-content">{textParts.join("\n\n")}</pre>
      ) : null}
      {diffs.length === 0 && textParts.length === 0 && card?.content != null ? (
        <pre className="tool-content">
          {typeof card.content === "string"
            ? card.content
            : JSON.stringify(card.content, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Normalizes tool content into an object array; supports a single object, a JSON array, or unknown shapes.
 * @param content toolCalls[id].content; undefined means no body yet.
 * @returns Traversable fragment list; returns [] when unrecognized.
 */
function normalizeToolContentParts(content: unknown): Array<Record<string, unknown>> {
  if (content == null) {return [];}
  if (Array.isArray(content)) {
    return content.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (typeof content === "object") {
    return [content as Record<string, unknown>];
  }
  return [];
}

/**
 * Extracts readable text from a content fragment (type=content/text or a direct text field).
 * @param part Normalized content item.
 * @returns Plain text, or null when there is none.
 */
function extractToolText(part: Record<string, unknown>): string | null {
  if (part.type === "diff") {return null;}
  if (typeof part.text === "string" && part.text) {return part.text;}
  const nested = part.content;
  if (typeof nested === "string" && nested) {return nested;}
  if (Array.isArray(nested)) {
    const chunks = nested
      .map((item) => {
        if (!item || typeof item !== "object") {return "";}
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") {return rec.text;}
        return "";
      })
      .filter(Boolean);
    return chunks.length > 0 ? chunks.join("\n") : null;
  }
  if (nested && typeof nested === "object") {
    const n = nested as { type?: string; text?: string };
    if (typeof n.text === "string" && n.text) {return n.text;}
  }
  return null;
}
