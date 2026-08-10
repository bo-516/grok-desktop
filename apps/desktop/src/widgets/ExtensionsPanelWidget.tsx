/**
 * Extensions / inspect panel (F-EXT-16) — loads `grok inspect --json` via bridge CLI.
 */

import { useCallback, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { SidePanelShell } from "./SidePanelShell";

/**
 * Stateful panel: fetch inspect dump, MCP list, doctor.
 * @param props open/onClose — parent toggles; shell handles dismiss
 */
export function ExtensionsPanelWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const runCli = useSessionStore((s) => s.runCli);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<unknown>(null);
  const [mcp, setMcp] = useState<unknown>(null);
  const [doctorName, setDoctorName] = useState("");
  const [doctorOut, setDoctorOut] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [insp, mcpList] = await Promise.all([
        runCli("inspect"),
        runCli("mcp_list"),
      ]);
      if (!insp.ok) {
        setError(insp.error ?? "inspect failed");
      } else {
        setInspect(insp.data);
      }
      if (mcpList.ok) {
        setMcp(mcpList.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [runCli]);

  return (
    <SidePanelShell
      open={props.open}
      label="Extensions"
      title="Extensions & config"
      onClose={props.onClose}
    >
      {/* Sections own the drawer's vertical rhythm — side-panel-body adds no gap. */}
      <section className="side-panel-section">
        <p className="side-panel-hint">
          Source of truth: <code>grok inspect --json</code> (F-EXT-16). Results
          must match the CLI.
        </p>
        <div className="side-panel-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Loading…" : "Refresh inspect"}
          </button>
        </div>
        {/* panel-note, not `banner`: banner's main-column margins paint inset here. */}
        {error ? (
          <p className="panel-note panel-note-danger" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Inspect</h3>
        <pre className="code-block">
          {inspect ? JSON.stringify(inspect, null, 2) : "—"}
        </pre>
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">MCP servers</h3>
        <pre className="code-block">
          {mcp ? JSON.stringify(mcp, null, 2) : "—"}
        </pre>
        <div className="row-gap">
          <input
            className="text-input"
            placeholder="Server name for doctor"
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void runCli("mcp_doctor", { name: doctorName }).then((r) => {
                setDoctorOut(r.ok ? r.data : r.error);
              });
            }}
          >
            Doctor
          </button>
        </div>
        {doctorOut != null ? (
          <pre className="code-block">{JSON.stringify(doctorOut, null, 2)}</pre>
        ) : null}
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Hooks trust</h3>
        <p className="side-panel-hint">
          Opening a repo with project hooks requires explicit trust (F-EXT-15).
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void runCli("hooks_trust");
          }}
        >
          Trust current workspace hooks
        </button>
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Plugins</h3>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void runCli("plugin", { action: "list" }).then((r) => {
              setInspect(r.ok ? r.data : r.error);
            });
          }}
        >
          List plugins
        </button>
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-section-title">Add HTTP MCP</h3>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void runCli("mcp_add_http", {
              name: "example-http",
              url: "https://example.com/mcp",
            });
          }}
        >
          Add example HTTP MCP
        </button>
      </section>
    </SidePanelShell>
  );
}
