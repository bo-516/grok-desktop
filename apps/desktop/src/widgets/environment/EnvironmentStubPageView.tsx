/**
 * Phase-2 placeholder page for Agents / Plugins / Hooks / Rules / Compat.
 * Honest empty-state: names the domain and that the full page ships later.
 */

import type { EnvironmentPageId } from "@/store/environmentStore";
import {
  EnvironmentToolbarView,
  type EnvironmentScopeFilter,
} from "./EnvironmentToolbarView";
import { useState } from "react";

export type EnvironmentStubPageViewProps = {
  /** Page id for copy. */
  page: EnvironmentPageId;
  /** Human title. */
  title: string;
  /** Count already known from inspect (shown in the empty state). */
  count: number;
  /** Refresh still reloads the whole snapshot. */
  onRefresh: () => void;
  loading: boolean;
  loadedLabel: string | null;
};

/**
 * Stub page body for domains not fully built in Phase 1.
 * @param props Page identity + refresh wiring.
 */
export function EnvironmentStubPageView(props: EnvironmentStubPageViewProps) {
  const { page, title, count, onRefresh, loading, loadedLabel } = props;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<EnvironmentScopeFilter>("all");
  void page;
  void query;
  void scope;

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
        searchPlaceholder={`Search ${title.toLowerCase()}…`}
      />
      <div className="env-empty">
        <p className="env-empty-title">{title}</p>
        <p className="env-empty-hint">
          {count > 0
            ? `Inspect currently reports ${count} item${count === 1 ? "" : "s"}. A structured list for this domain ships in a later phase; counts are visible on Overview.`
            : `No ${title.toLowerCase()} in the current inspect snapshot. A structured list for this domain ships in a later phase.`}
        </p>
      </div>
    </div>
  );
}
