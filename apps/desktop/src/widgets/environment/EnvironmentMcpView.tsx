/**
 * Environment MCP servers page — structured rows from merged inspect ⊕ list ⊕ doctor.
 * Stateless list; parent owns search/filter, doctor action, and pending keys.
 */

import { useMemo, useState } from "react";
import type { McpRow } from "@/lib/inspectModel";
import {
  EnvironmentPathMeta,
  EnvironmentSourceChip,
  EnvironmentStatusDot,
  statusForMcp,
} from "./EnvironmentRowShared";
import {
  EnvironmentToolbarView,
  type EnvironmentScopeFilter,
} from "./EnvironmentToolbarView";

export type EnvironmentMcpViewProps = {
  /** Merged MCP rows from the store snapshot. */
  rows: McpRow[];
  /** Active workspace for path shortening. */
  workspace?: string;
  /** Force reload. */
  onRefresh: () => void;
  /** Loading flag for toolbar. */
  loading: boolean;
  /** Relative loaded label. */
  loadedLabel: string | null;
  /**
   * Run doctor for one server name.
   * @param name Server id.
   */
  onDoctor: (name: string) => void;
  /** Pending action keys (`mcp:name:doctor`). */
  pending: Record<string, true>;
};

/**
 * Filter MCP rows by client-side query + scope.
 * @param rows Full merged list.
 * @param query Substring over name/target.
 * @param scope Source kind filter or all.
 */
function filterMcpRows(
  rows: McpRow[],
  query: string,
  scope: EnvironmentScopeFilter,
): McpRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (scope !== "all" && row.source.kind !== scope) {
      return false;
    }
    if (!q) {
      return true;
    }
    const hay = `${row.name} ${row.target} ${row.source.pluginName ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * MCP servers page body.
 * @param props Rows + refresh/doctor handlers from useEnvironmentWidget.
 */
export function EnvironmentMcpView(props: EnvironmentMcpViewProps) {
  const {
    rows,
    workspace,
    onRefresh,
    loading,
    loadedLabel,
    onDoctor,
    pending,
  } = props;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<EnvironmentScopeFilter>("all");
  const filtered = useMemo(
    () => filterMcpRows(rows, query, scope),
    [rows, query, scope],
  );

  return (
    <div className="env-page">
      <EnvironmentToolbarView
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        onRefresh={onRefresh}
        loading={loading}
        loadedLabel={loadedLabel}
        searchPlaceholder="Search MCP servers…"
      />
      {rows.length === 0 ? (
        <div className="env-empty">
          <p className="env-empty-title">No MCP servers</p>
          <p className="env-empty-hint">
            Active servers come from inspect (including plugins). Config-only
            entries from <code>mcp list</code> appear here too when present.
            Add servers with <code>grok mcp add</code> or install a plugin that
            provides one.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="env-empty">
          <p className="env-empty-title">No matches</p>
          <p className="env-empty-hint">Try a different search or scope filter.</p>
        </div>
      ) : (
        <ul className="env-list">
          {filtered.map((row) => {
            const status = statusForMcp(row);
            const doctorKey = `mcp:${row.name}:doctor`;
            const doctorBusy = pending[doctorKey] === true;
            return (
              <li key={row.name} className="env-row group">
                <div className="env-row-main">
                  <EnvironmentStatusDot
                    kind={status}
                    label={row.health?.summary ?? status}
                  />
                  <span className="env-row-name">{row.name}</span>
                  <EnvironmentSourceChip source={row.source} />
                  <span className="env-row-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={doctorBusy}
                      onClick={() => onDoctor(row.name)}
                    >
                      {doctorBusy ? "Doctor…" : "Doctor"}
                    </button>
                  </span>
                </div>
                <div className="env-row-meta">
                  <span className="env-row-desc">
                    {row.transport}
                    {row.target ? ` · ${row.target}` : ""}
                    {row.inactive ? " · inactive (config only)" : ""}
                    {row.enabled === false ? " · disabled" : ""}
                    {row.health
                      ? ` · ${row.health.healthy ? "healthy" : "failing"}`
                      : ""}
                  </span>
                </div>
                <EnvironmentPathMeta
                  path={row.source.path}
                  workspace={workspace}
                />
                {row.envKeys?.length ? (
                  <div className="env-row-meta">
                    env: {row.envKeys.map((k) => `${k}=••••`).join(", ")}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
