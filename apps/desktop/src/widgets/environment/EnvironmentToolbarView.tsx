/**
 * Shared Environment page toolbar: search, optional scope filter, refresh, loaded ago.
 * Stateless — parent owns query/filter and refresh handler.
 */

import type { SourceKind } from "@/lib/inspectModel";

/** Scope filter options shown in the toolbar select. */
export type EnvironmentScopeFilter = "all" | SourceKind;

export type EnvironmentToolbarViewProps = {
  /** Client-side search query. */
  query: string;
  /** Update search query. */
  onQueryChange: (q: string) => void;
  /** Current scope filter. */
  scope: EnvironmentScopeFilter;
  /** Update scope filter. */
  onScopeChange: (s: EnvironmentScopeFilter) => void;
  /** Refresh handler (force reload). */
  onRefresh: () => void;
  /** True while load is in flight. */
  loading: boolean;
  /** Relative "loaded … ago" label, or null. */
  loadedLabel: string | null;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** When false, hide the scope select (Overview). */
  showScope?: boolean;
};

const SCOPE_OPTIONS: Array<{ value: EnvironmentScopeFilter; label: string }> = [
  { value: "all", label: "All scopes" },
  { value: "bundled", label: "Bundled" },
  { value: "user", label: "User" },
  { value: "project", label: "Project" },
  { value: "plugin", label: "Plugin" },
  { value: "builtin", label: "Built-in" },
];

/**
 * Renders search · scope · refresh · loaded meta for an Environment page.
 * @param props Query/scope/refresh wiring from the page view or sheet hook.
 */
export function EnvironmentToolbarView(props: EnvironmentToolbarViewProps) {
  const {
    query,
    onQueryChange,
    scope,
    onScopeChange,
    onRefresh,
    loading,
    loadedLabel,
    searchPlaceholder = "Search…",
    showScope = true,
  } = props;

  return (
    <div className="env-toolbar">
      <div className="env-toolbar-search">
        <input
          className="text-input"
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search environment items"
        />
      </div>
      {showScope ? (
        <div className="ui-select-wrap max-w-40">
          <select
            className="ui-select"
            value={scope}
            onChange={(e) =>
              onScopeChange(e.target.value as EnvironmentScopeFilter)
            }
            aria-label="Filter by scope"
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button
        type="button"
        className="btn-ghost"
        disabled={loading}
        onClick={onRefresh}
      >
        {loading ? "Loading…" : "Refresh"}
      </button>
      {loadedLabel ? (
        <span className="env-toolbar-meta">loaded {loadedLabel}</span>
      ) : null}
    </div>
  );
}
