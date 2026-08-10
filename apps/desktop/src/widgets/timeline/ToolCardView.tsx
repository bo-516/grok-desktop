/**
 * Pure presentation for a tool-call card; status and content always come from
 * the acp-core patch-merge Map. Edit diffs render as compact summary rows that
 * open the preview drawer (D3) — not full interactive review in-stream.
 *
 * Paths are shown workspace-relative (then `~`, then absolute) while every
 * click / copy / preview read keeps using the real absolute path.
 */

import cs from "classnames";
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
        {textParts.length > 0 ? (
          <pre className="tool-content">{textParts.join("\n\n")}</pre>
        ) : null}
        {status === "failed" &&
        !hasDiffSummaries &&
        textParts.length === 0 ? (
          <pre className="tool-content tool-error">
            {typeof card?.content === "string"
              ? card.content
              : JSON.stringify(card?.content ?? card?.meta ?? {}, null, 2)}
          </pre>
        ) : null}
        {!hasDiffSummaries &&
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
    </div>
  );
}
