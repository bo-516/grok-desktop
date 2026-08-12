/**
 * Environment Overview page — version, trust, config layers, domain counts.
 * Stateless; jump cards call onOpenPage for deep links into MCP / Skills / …
 */

import type { InspectSnapshot } from "@/lib/inspectModel";
import type { EnvironmentPageId } from "@/store/environmentStore";

export type EnvironmentOverviewViewProps = {
  /** Normalized snapshot, or null while empty/error. */
  snapshot: InspectSnapshot | null;
  /** Navigate to a domain page. */
  onOpenPage: (page: EnvironmentPageId) => void;
};

type CountCard = {
  page: EnvironmentPageId;
  label: string;
  count: number;
};

/**
 * Build domain count cards from a snapshot (zeros when null).
 * @param snapshot Inspect snapshot or null.
 */
function countCards(snapshot: InspectSnapshot | null): CountCard[] {
  return [
    { page: "mcp", label: "MCP servers", count: snapshot?.mcpServers.length ?? 0 },
    { page: "skills", label: "Skills", count: snapshot?.skills.length ?? 0 },
    { page: "agents", label: "Agents", count: snapshot?.agents.length ?? 0 },
    { page: "plugins", label: "Plugins", count: snapshot?.plugins.length ?? 0 },
    { page: "hooks", label: "Hooks", count: snapshot?.hooks.length ?? 0 },
    {
      page: "rules",
      label: "Rules",
      count: snapshot?.instructions.length ?? 0,
    },
  ];
}

/**
 * Overview body for the Environment sheet.
 * @param props snapshot + page jump handler.
 */
export function EnvironmentOverviewView(props: EnvironmentOverviewViewProps) {
  const { snapshot, onOpenPage } = props;
  const cards = countCards(snapshot);

  if (!snapshot) {
    return (
      <div className="env-empty">
        <p className="env-empty-title">No inspect data yet</p>
        <p className="env-empty-hint">
          Click Refresh to load <code>grok inspect --json</code> for the active
          workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="env-page">
      <div className="env-overview-meta">
        <p className="m-0">
          <strong>Grok</strong> {snapshot.grokVersion || "—"}
          {snapshot.channel ? (
            <span className="text-fg-muted"> · {snapshot.channel}</span>
          ) : null}
        </p>
        <p className="m-0">
          <strong>Project</strong>{" "}
          <span title={snapshot.projectRoot || snapshot.cwd}>
            {snapshot.projectRoot || snapshot.cwd || "—"}
          </span>
        </p>
        <p className="m-0">
          <strong>Project trusted</strong>{" "}
          {snapshot.projectTrusted ? "yes" : "no"}
          <span className="text-fg-muted">
            {" "}
            (see ~/.grok/trusted_folders.toml — trust is granted on first
            interactive open; this sheet does not write it)
          </span>
        </p>
        {snapshot.configLayers.length > 0 ? (
          <p className="m-0">
            <strong>Config layers</strong>{" "}
            {snapshot.configLayers
              .map((l) => `${l.role}: ${l.path}`)
              .join(" · ")}
          </p>
        ) : null}
        {snapshot.warnings.length > 0 ? (
          <p className="panel-note panel-note-warning" role="status">
            {snapshot.warnings.length} config warning
            {snapshot.warnings.length === 1 ? "" : "s"}:{" "}
            {snapshot.warnings
              .map((w) => w.path || w.kind || w.reason)
              .join("; ")}
          </p>
        ) : null}
        {snapshot.rawFallback ? (
          <p className="panel-note panel-note-danger" role="alert">
            Inspect returned text only (no JSON). Showing empty domains.
          </p>
        ) : null}
      </div>
      <div className="env-overview-grid">
        {cards.map((card) => (
          <button
            key={card.page}
            type="button"
            className="env-overview-card"
            onClick={() => onOpenPage(card.page)}
          >
            <p className="env-overview-card-label">{card.label}</p>
            <p className="env-overview-card-value">{card.count}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
