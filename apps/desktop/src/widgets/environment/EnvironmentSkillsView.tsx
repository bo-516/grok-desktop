/**
 * Environment Skills page — structured list from inspect.skills.
 * Stateless; local search/scope only; copy `/name` for invocable skills.
 */

import { useMemo, useState } from "react";
import type { SkillRow } from "@/lib/inspectModel";
import {
  EnvironmentPathMeta,
  EnvironmentSourceChip,
} from "./EnvironmentRowShared";
import {
  EnvironmentToolbarView,
  type EnvironmentScopeFilter,
} from "./EnvironmentToolbarView";

export type EnvironmentSkillsViewProps = {
  /** Skills from the normalized snapshot. */
  rows: SkillRow[];
  /** Active workspace for path shortening. */
  workspace?: string;
  /** Force reload. */
  onRefresh: () => void;
  /** Loading flag. */
  loading: boolean;
  /** Relative loaded label. */
  loadedLabel: string | null;
};

/**
 * Filter skills by query + scope.
 * @param rows Full skill list.
 * @param query Substring over name/description.
 * @param scope Source kind or all.
 */
function filterSkills(
  rows: SkillRow[],
  query: string,
  scope: EnvironmentScopeFilter,
): SkillRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (scope !== "all" && row.source.kind !== scope) {
      return false;
    }
    if (!q) {
      return true;
    }
    const hay =
      `${row.name} ${row.description} ${row.source.pluginName ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Copy a slash-invocation token to the clipboard when available.
 * @param name Skill name without leading slash.
 */
async function copySlashName(name: string): Promise<void> {
  const text = `/${name}`;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be denied; ignore — UI still shows the button.
    }
  }
}

/**
 * Skills page body.
 * @param props Rows + refresh wiring from useEnvironmentWidget.
 */
export function EnvironmentSkillsView(props: EnvironmentSkillsViewProps) {
  const { rows, workspace, onRefresh, loading, loadedLabel } = props;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<EnvironmentScopeFilter>("all");
  const filtered = useMemo(
    () => filterSkills(rows, query, scope),
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
        searchPlaceholder="Search skills…"
      />
      {rows.length === 0 ? (
        <div className="env-empty">
          <p className="env-empty-title">No skills discovered</p>
          <p className="env-empty-hint">
            Skills come from bundled packages, user/project SKILL.md trees, and
            plugins. Install a skill or plugin, then Refresh.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="env-empty">
          <p className="env-empty-title">No matches</p>
          <p className="env-empty-hint">Try a different search or scope filter.</p>
        </div>
      ) : (
        <ul className="env-list">
          {filtered.map((row) => (
            <li key={`${row.source.kind}:${row.name}:${row.source.path ?? ""}`} className="env-row group">
              <div className="env-row-main">
                <span className="env-row-name">{row.name}</span>
                {row.userInvocable ? (
                  <span className="env-chip" title="Invocable as slash command">
                    /{row.name}
                  </span>
                ) : null}
                <EnvironmentSourceChip source={row.source} />
                {row.userInvocable ? (
                  <span className="env-row-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void copySlashName(row.name)}
                    >
                      Copy /
                    </button>
                  </span>
                ) : null}
              </div>
              {row.description ? (
                <div className="env-row-meta">
                  <span className="env-row-desc" title={row.description}>
                    {row.description}
                  </span>
                </div>
              ) : null}
              <EnvironmentPathMeta
                path={row.source.path}
                workspace={workspace}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
