/**
 * Pure presentation for a tool-call card; status and content always come from
 * the acp-core patch-merge Map. Edit diffs render as compact summary rows that
 * open the preview drawer (D3) — not full interactive review in-stream.
 *
 * Paths are shown workspace-relative (then `~`, then absolute) while every
 * click / copy / preview read keeps using the real absolute path.
 * Large raw text / JSON dumps collapse by default so the rail stays scannable.
 */

import cs from "classnames";
import { useState } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { parseMcpToolName } from "../../lib/diffReview";
import { toPathDisplay } from "../../lib/pathDisplay";
import {
  extractToolText,
  normalizeLocations,
  normalizeToolContentParts,
  summarizeEditContent,
} from "../../lib/toolCardContent";
import { usePreviewStore } from "../../store/previewStore";
import { useSessionStore } from "../../store/sessionStore";
import { useCopyFeedback } from "../shared";
import { EditSummaryRowView } from "./EditSummaryRowView";
import { ToolCardHeadView } from "./ToolCardHeadView";
import { ToolLocationListView } from "./ToolLocationListView";

type ToolCardViewProps = {
  toolCallId: string;
  card: ToolCallCard | undefined;
};

/** Collapse tool body when it exceeds this many characters (JSON dumps). */
const TOOL_CONTENT_COLLAPSE_CHARS = 480;
/** Collapse when the body has more than this many lines. */
const TOOL_CONTENT_COLLAPSE_LINES = 12;

/**
 * Format unknown tool content into a readable string for the fallback pre.
 * @param content Raw card content or meta.
 * @returns Pretty JSON when object-like; string as-is.
 */
function formatToolFallback(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return JSON.stringify(content ?? {}, null, 2);
  } catch {
    return String(content);
  }
}

/**
 * Whether a tool body is large enough to start collapsed.
 * @param text Full body text.
 */
function shouldCollapseToolText(text: string): boolean {
  if (text.length > TOOL_CONTENT_COLLAPSE_CHARS) {
    return true;
  }
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1;
      if (lines > TOOL_CONTENT_COLLAPSE_LINES) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Collapsible tool body: short dumps stay open; large JSON starts collapsed.
 * @param props Body text and optional error styling.
 */
function ToolContentBody(props: { text: string; error?: boolean }) {
  const { text, error = false } = props;
  const large = shouldCollapseToolText(text);
  const [expanded, setExpanded] = useState(!large);
  const className = cs("tool-content", {
    "tool-error": error,
    "tool-content-collapsed": large && !expanded,
  });
  return (
    <div className="tool-content-wrap">
      <pre className={className}>{text}</pre>
      {large ? (
        <button
          type="button"
          className="tool-content-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Show full output"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Displays one ACP tool_call including status, title, kind-specific layout,
 * compact edit summaries, and text/error fallbacks.
 * @param props When card is missing, show toolCallId so out-of-order updates
 *   cannot produce blank rows.
 */
export function ToolCardView(props: ToolCardViewProps) {
  const { card, toolCallId } = props;
  const openPreview = usePreviewStore((s) => s.openPreview);
  /** Workspace root drives path shortening only; empty keeps paths absolute. */
  const workspace = useSessionStore((s) => s.session.workspace);
  const { copiedKey, copy } = useCopyFeedback();
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
  const editSummaries = summarizeEditContent(card?.content);
  const textParts = parts
    .map((p) => extractToolText(p))
    .filter((t): t is string => Boolean(t));
  const locations = normalizeLocations(card?.rawLocations);
  const hasDiffSummaries = editSummaries.length > 0;
  const joinedText = textParts.length > 0 ? textParts.join("\n\n") : "";
  const failedFallback =
    status === "failed" && !hasDiffSummaries && textParts.length === 0
      ? formatToolFallback(card?.content ?? card?.meta ?? {})
      : "";
  const rawFallback =
    !hasDiffSummaries &&
    textParts.length === 0 &&
    status !== "failed" &&
    card?.content != null
      ? formatToolFallback(card.content)
      : "";

  return (
    <div className={cs("item-tool", kindClass)}>
      <div
        data-kind="tool"
        data-tool-id={toolCallId}
        data-tool-status={status}
      >
        <ToolCardHeadView
          kind={kind}
          title={title}
          workspace={workspace}
          mcp={mcp}
          status={status}
          badgeClass={badgeClass}
        />
        <ToolLocationListView
          locations={locations}
          workspace={workspace}
          copiedKey={copiedKey}
          onOpen={(loc) => {
            openPreview({ kind: "file", path: loc });
          }}
          onCopy={(fullPath) => {
            copy(fullPath, fullPath);
          }}
        />
        {editSummaries.map((summary) => {
          const display = toPathDisplay(summary.path, workspace);
          return (
            <EditSummaryRowView
              key={`edit-${summary.path}`}
              summary={summary}
              display={display}
              copied={copiedKey === display.full}
              onCopy={() => {
                copy(display.full, display.full);
              }}
              onOpen={() => {
                if (summary.noDiffData) {
                  openPreview({ kind: "file", path: summary.path });
                  return;
                }
                openPreview({
                  kind: "diff",
                  path: summary.path,
                  toolCallId,
                });
              }}
            />
          );
        })}
        {joinedText ? <ToolContentBody text={joinedText} /> : null}
        {failedFallback ? (
          <ToolContentBody text={failedFallback} error />
        ) : null}
        {rawFallback ? <ToolContentBody text={rawFallback} /> : null}
      </div>
    </div>
  );
}
