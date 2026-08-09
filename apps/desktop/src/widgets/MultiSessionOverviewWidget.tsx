/**
 * Multi-session overview (F-MULTI-01/03/04/07) — group by status, peek send, permission.
 */

import cs from "classnames";
import { useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  filterOverviewSessions,
  groupByOverviewStatus,
  type OverviewSession,
  type OverviewStatus,
} from "../lib/multiSession";
import { SidePanelShell } from "./SidePanelShell";

const BUCKETS: OverviewStatus[] = [
  "needs_input",
  "working",
  "idle",
  "inactive",
  "completed",
  "failed",
];

/**
 * Stateful overview panel over catalog + pool.
 * @param props open/onClose — parent toggles; shell handles dismiss
 */
export function MultiSessionOverviewWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const catalog = useSessionStore((s) => s.catalog);
  const poolEntries = useSessionStore((s) => s.poolEntries);
  const selectSession = useSessionStore((s) => s.selectSession);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const session = useSessionStore((s) => s.session);
  const [query, setQuery] = useState("");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekText, setPeekText] = useState("");

  const rows: OverviewSession[] = useMemo(() => {
    const poolMap = new Map(poolEntries.map((e) => [e.sessionId, e]));
    return catalog.map((c) => {
      const pe = poolMap.get(c.id);
      return {
        id: c.id,
        title: c.title,
        workspace: c.workspace,
        status: pe?.status ?? c.status,
        live: pe?.live,
        pendingPermission:
          session.id === c.id && session.status === "waiting_permission",
      };
    });
  }, [catalog, poolEntries, session.id, session.status]);

  const filtered = useMemo(
    () => filterOverviewSessions(rows, query),
    [rows, query],
  );
  const groups = useMemo(
    () => groupByOverviewStatus(filtered),
    [filtered],
  );

  return (
    <SidePanelShell
      open={props.open}
      label="Session overview"
      title="Overview"
      onClose={props.onClose}
    >
      <input
        className="text-input"
        placeholder="Search · s:working · a:name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {BUCKETS.map((bucket) => {
        const list = groups[bucket];
        if (!list.length) {
          return null;
        }
        return (
          <section key={bucket} className="side-panel-section">
            <h3 className="side-panel-section-title overview-bucket">
              {bucket.replace("_", " ")}
            </h3>
            <ul className="overview-list">
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={cs("overview-row", {
                      "overview-row-live": s.live,
                    })}
                    onClick={() => selectSession(s.id)}
                  >
                    <span className="overview-title">{s.title}</span>
                    <span className="overview-status">{s.status}</span>
                  </button>
                  <div className="overview-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setPeekId(s.id)}
                    >
                      Peek
                    </button>
                    {s.pendingPermission ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            selectSession(s.id);
                            respondPermission("allow_once");
                          }}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => {
                            selectSession(s.id);
                            respondPermission("deny");
                          }}
                        >
                          Deny
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {peekId ? (
        <div className="peek-panel">
          <p className="side-panel-hint">Peek → {peekId.slice(0, 8)}</p>
          <textarea
            className="text-input"
            rows={3}
            value={peekText}
            onChange={(e) => setPeekText(e.target.value)}
            placeholder="Message without fully focusing the chat…"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              selectSession(peekId);
              void sendPrompt(peekText).then(() => {
                setPeekText("");
                setPeekId(null);
              });
            }}
          >
            Send peek
          </button>
        </div>
      ) : null}
    </SidePanelShell>
  );
}
