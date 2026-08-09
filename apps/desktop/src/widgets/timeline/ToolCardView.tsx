/** Pure presentation for a tool-call card; status and content always come from the acp-core patch-merge Map. */

import cs from "classnames";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { parseMcpToolName } from "../../lib/diffReview";
import { DiffReviewView } from "./DiffReviewView";
import { SpotlightCard } from "@/components/react-bits";

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
 * Displays one ACP tool_call including status, title, kind-specific layout, and line diffs.
 * @param props When card is missing, show toolCallId so out-of-order tool_call_update cannot produce blank rows.
 */
export function ToolCardView(props: ToolCardViewProps) {
  const { card, toolCallId } = props;
  const title = card?.title ?? toolCallId;
  const status = card?.status ?? "pending";
  const kind = card?.kind ?? "tool";
  const mcp = parseMcpToolName(title);
  const badgeClass = cs("badge", {
    "badge-pending": status === "pending" || status === "in_progress",
    "badge-failed": status === "failed",
    "badge-ok": status === "completed",
  });
  const kindClass = cs("tool-kind", {
    "tool-kind-edit": kind === "edit",
    "tool-kind-execute": kind === "execute",
    "tool-kind-read": kind === "read",
    "tool-kind-failed": status === "failed",
  });
  const parts = normalizeToolContentParts(card?.content);
  const diffs = parts.filter((p): p is DiffContent => p.type === "diff");
  const textParts = parts
    .map((p) => extractToolText(p))
    .filter((t): t is string => Boolean(t));
  const locations = normalizeLocations(card?.rawLocations);

  return (
    <SpotlightCard className={cs("item-tool", kindClass)}>
      <div
        data-kind="tool"
        data-tool-id={toolCallId}
        data-tool-status={status}
      >
        <div className="tool-head">
          <span>
            <span className="tool-kind-label">{kind}</span>
            {mcp ? (
              <span className="tool-mcp" title={`MCP ${mcp.server}`}>
                {mcp.server}__{mcp.tool}
              </span>
            ) : (
              <span> · {title}</span>
            )}
          </span>
          <span className={badgeClass}>{status}</span>
        </div>
        {locations.length > 0 ? (
          <div className="tool-locations">
            {locations.map((loc) => (
              <button
                key={loc}
                type="button"
                className="tool-loc-link"
                title="Open in system editor"
                onClick={() => {
                  // Best-effort: desktop may host file:// open via bridge later
                  window.open(`file://${loc}`, "_blank");
                }}
              >
                {loc}
              </button>
            ))}
          </div>
        ) : null}
        {diffs.map((diff, i) => (
          <DiffReviewView
            key={`diff-${diff.path ?? i}`}
            path={diff.path ?? "file"}
            oldText={diff.oldText}
            newText={diff.newText}
          />
        ))}
        {textParts.length > 0 ? (
          <pre className="tool-content">{textParts.join("\n\n")}</pre>
        ) : null}
        {status === "failed" && diffs.length === 0 && textParts.length === 0 ? (
          <pre className="tool-content tool-error">
            {typeof card?.content === "string"
              ? card.content
              : JSON.stringify(card?.content ?? card?.meta ?? {}, null, 2)}
          </pre>
        ) : null}
        {diffs.length === 0 &&
        textParts.length === 0 &&
        status !== "failed" &&
        card?.content != null ? (
          <pre className="tool-content">
            {typeof card.content === "string"
              ? card.content
              : JSON.stringify(card.content, null, 2)}
          </pre>
        ) : null}
      </div>
    </SpotlightCard>
  );
}

/**
 * Normalizes tool content into an object array; supports a single object, a JSON array, or unknown shapes.
 * @param content toolCalls[id].content; undefined means no body yet.
 */
function normalizeToolContentParts(content: unknown): Array<Record<string, unknown>> {
  if (content == null) {
    return [];
  }
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
 */
function extractToolText(part: Record<string, unknown>): string | null {
  if (part.type === "diff") {
    return null;
  }
  if (typeof part.text === "string" && part.text) {
    return part.text;
  }
  const nested = part.content;
  if (typeof nested === "string" && nested) {
    return nested;
  }
  if (Array.isArray(nested)) {
    const chunks = nested
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") {
          return rec.text;
        }
        return "";
      })
      .filter(Boolean);
    return chunks.length > 0 ? chunks.join("\n") : null;
  }
  if (nested && typeof nested === "object") {
    const n = nested as { type?: string; text?: string };
    if (typeof n.text === "string" && n.text) {
      return n.text;
    }
  }
  return null;
}

/**
 * Normalize locations array for file jump links.
 * @param raw card.rawLocations from agent.
 */
function normalizeLocations(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (typeof raw === "string") {
    return [raw];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push(item);
    } else if (item && typeof item === "object") {
      const rec = item as { path?: string; uri?: string };
      if (rec.path) {
        out.push(rec.path);
      } else if (rec.uri) {
        out.push(rec.uri);
      }
    }
  }
  return out;
}
