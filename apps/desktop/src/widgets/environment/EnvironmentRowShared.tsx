/**
 * Shared row anatomy for Environment lists: status dot, provenance chip, path,
 * plus the common "no matches" filter empty state.
 * Stateless pure presentation helpers used by MCP / Skills / stub pages.
 */

import cs from "classnames";
import {
  mcpStatusKind,
  sourceChipLabel,
  type ItemSource,
  type McpRow,
} from "@/lib/inspectModel";
import { toPathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

/**
 * Provenance chip for a source.
 * @param props source Item provenance; missing path is fine.
 */
export function EnvironmentSourceChip(props: { source: ItemSource }) {
  return (
    <span className="env-chip" title={props.source.path ?? sourceChipLabel(props.source)}>
      {sourceChipLabel(props.source)}
    </span>
  );
}

/**
 * MCP / plugin status dot (healthy · failing · disabled · unchecked hollow ring).
 * @param props kind Status vocabulary key.
 */
export function EnvironmentStatusDot(props: {
  kind: ReturnType<typeof mcpStatusKind> | "healthy" | "failing" | "disabled" | "unchecked";
  label?: string;
}) {
  const { kind, label } = props;
  return (
    <span
      className={cs("env-status-dot", {
        "env-status-healthy": kind === "healthy",
        "env-status-failing": kind === "failing",
        "env-status-disabled": kind === "disabled",
        "env-status-unchecked": kind === "unchecked",
      })}
      title={label ?? kind}
      aria-label={label ?? kind}
      role="img"
    />
  );
}

/**
 * Path meta line using PathLabelView (relative when workspace known).
 * @param props path Absolute path; workspace optional for relative shortening.
 */
export function EnvironmentPathMeta(props: {
  path?: string;
  workspace?: string;
}) {
  const { path, workspace } = props;
  if (!path) {
    return null;
  }
  const display = toPathDisplay(path, workspace ?? "");
  return (
    <span className="env-row-meta" title={display.full}>
      <PathLabelView display={display} />
    </span>
  );
}

/**
 * Empty state shown when a list has rows but the local search / scope filter
 * hides all of them. Stateless; identical copy across Environment pages.
 */
export function EnvironmentNoMatchesView() {
  return (
    <div className="env-empty">
      <p className="env-empty-title">No matches</p>
      <p className="env-empty-hint">Try a different search or scope filter.</p>
    </div>
  );
}

/**
 * Status kind for an MCP row (re-export helper for views).
 * @param row Merged MCP row.
 */
export function statusForMcp(row: McpRow) {
  return mcpStatusKind(row);
}
