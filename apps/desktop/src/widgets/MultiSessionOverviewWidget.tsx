/**
 * Multi-session overview (F-MULTI-01/03/04/07) — group by status, peek send, permission.
 * WORKING is live-pool streaming only; harness subagents stay off this list.
 */

import cs from "classnames";
import { useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  buildOverviewSessions,
  filterOverviewSessions,
  groupByOverviewStatus,
  limitOverviewSessions,
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
 * Rows hide harness subagents (same list as the session rail) and only
 * paint WORKING when a live pool process is streaming — matches "N running".
 * After search, only the newest 100 matches paint (display cap, not catalog).
 * Search lives in the shell toolbar so it stays put while buckets scroll.
 * @param props open/onClose — parent toggles; shell handles dismiss
 */
export function MultiSessionOverviewWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const catalog = useSessionStore((s) => s.catalog);
  const poolEntries = useSessionStore((s) => s.poolEntries);
  const sessionRoles = useSessionStore((s) => s.sessionRoles);
  const selectSession = useSessionStore((s) => s.selectSession);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const session = useSessionStore((s) => s.session);
  const [query, setQuery] = useState("");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekText, setPeekText] = useState("");

  const rows = useMemo(
    () =>
      buildOverviewSessions(catalog, poolEntries, {
        canvas: { id: session.id, status: session.status },
        sessionRoles,
      }),
    [catalog, poolEntries, session.id, session.status, sessionRoles],
  );

  const filtered = useMemo(
    () => filterOverviewSessions(rows, query),
    [rows, query],
  );
  /** Display cap: newest 100 matches. Search still runs on the full set. */
  const visible = useMemo(
    () => limitOverviewSessions(filtered),
    [filtered],
  );
  const groups = useMemo(
    () => groupByOverviewStatus(visible),
    [visible],
  );

  return (
    <SidePanelShell
      open={props.open}
      label="Session overview"
      title="Overview"
      onClose={props.onClose}
      toolbar={
        <input
          className="text-input"
          placeholder="Search · s:working · a:name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
    >
      {/* Sections own the drawer's vertical rhythm — side-panel-body adds no gap. */}
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
