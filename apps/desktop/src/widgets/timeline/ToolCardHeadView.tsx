/**
 * Tool card head: kind pill + title + status badge.
 * Titles carry an absolute path far more often than not, so a path title is
 * rendered as dir + file name — narrow cards then drop directory characters
 * instead of the file name, which plain text-overflow would eat first.
 */

import {
  relativizeTitlePaths,
  splitTitlePath,
  toPathDisplay,
} from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

export type ToolCardHeadViewProps = {
  /** ACP tool kind (edit / execute / read / …) shown as the leading pill. */
  kind: string;
  /** Raw title; always the tooltip and the fallback when it holds no path. */
  title: string;
  /** Workspace root for shortening; empty keeps the title untouched. */
  workspace: string;
  /** Parsed `server__tool` for MCP calls, or null for plain tools. */
  mcp: { server: string; tool: string } | null;
  /** Status text for the badge. */
  status: string;
  /** Precomputed badge class from the card. */
  badgeClass: string;
};

/**
 * @param props Kind / title / workspace context plus badge presentation.
 * @returns Head row; the title half shrinks, the status badge never does.
 */
export function ToolCardHeadView(props: ToolCardHeadViewProps) {
  const { kind, title, workspace, mcp, status, badgeClass } = props;
  return (
    <div className="tool-head">
      <span className="tool-head-main">
        <span className="tool-kind-label">{kind}</span>
        <ToolTitleView title={title} workspace={workspace} mcp={mcp} />
      </span>
      <span className={badgeClass}>{status}</span>
    </div>
  );
}

/**
 * Title half of the head: MCP name, split path title, or plain text.
 * @param props Raw title, workspace root and the parsed MCP name.
 * @returns One shrinkable inline label; full title stays in `title=`.
 */
function ToolTitleView(props: {
  title: string;
  workspace: string;
  mcp: { server: string; tool: string } | null;
}) {
  const { title, workspace, mcp } = props;
  if (mcp) {
    return (
      <span className="tool-mcp" title={`MCP ${mcp.server}`}>
        {mcp.server}__{mcp.tool}
      </span>
    );
  }
  const split = splitTitlePath(title);
  if (!split) {
    return (
      <span className="tool-title" title={title}>
        {" · "}
        {title}
      </span>
    );
  }
  // before/after can hold further paths (shell titles list several) — those get
  // the plain text shortening, only the first one becomes a dir + name label.
  return (
    <span className="tool-title-split" title={title}>
      <span className="tool-title-text">
        {" · "}
        {relativizeTitlePaths(split.before, workspace)}
      </span>
      <PathLabelView display={toPathDisplay(split.path, workspace)} />
      <span className="tool-title-text">
        {relativizeTitlePaths(split.after, workspace)}
      </span>
    </span>
  );
}
