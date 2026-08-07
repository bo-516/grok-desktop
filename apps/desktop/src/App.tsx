/**
 * Grok Desktop shell — Framer prototype layout:
 * left side-nav · top nav · chat timeline · bottom composer.
 * Live grok-build only (bridge → agent stdio).
 */

import cs from "classnames";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "./store/sessionStore";
import { TimelineView } from "./widgets/TimelineView";
import { ComposerWidget } from "@/widgets/composer";
import { PermissionModalView } from "./widgets/PermissionModalView";
import { PlanPanelView } from "./widgets/PlanPanelView";
import { SessionRailView } from "./widgets/SessionRailView";

export function App() {
  const session = useSessionStore((s) => s.session);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const bridgeInfo = useSessionStore((s) => s.bridgeInfo);
  const catalog = useSessionStore((s) => s.catalog);
  const hydrateCatalog = useSessionStore((s) => s.hydrateCatalog);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);
  const reconnect = useSessionStore((s) => s.reconnect);
  const autoStarted = useRef(false);
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    hydrateCatalog();
  }, [hydrateCatalog]);

  useEffect(() => {
    if (autoStarted.current) {return;}
    autoStarted.current = true;
    // Always resume last catalog session when possible — never auto session/new
    // on every page load (that was creating Chat 019… ghosts).
    const cat = useSessionStore.getState().catalog;
    const last = cat[0];
    if (last) {
      selectSession(last.id);
    } else {
      void reconnect().catch(() => undefined);
    }
  }, [reconnect, selectSession]);

  useEffect(() => {
    if (session.plan && session.plan.length > 0) {
      setShowPlan(true);
    }
  }, [session.plan]);

  const live = connectionMode === "live-bridge";
  const title =
    catalog.find((c) => c.id === session.id)?.title ||
    (session.timeline.length > 0 ? "Current chat" : "New chat");

  return (
    <div className="app-shell">
      <SessionRailView />

      <div className="main-column">
        <header className="top-nav">
          <div className="top-nav-left">
            <span className="top-nav-session-title" title={title}>
              {title}
            </span>
            <span className="top-nav-meta">
              {shortWs(session.workspace)}
              {bridgeInfo ? ` · ${bridgeInfo}` : ""}
            </span>
          </div>
          <div className="top-nav-right">
            <div className="top-nav-links">
              <button
                type="button"
                className={cs("top-nav-link", {
                  "top-nav-link-active": !showPlan,
                })}
                onClick={() => setShowPlan(false)}
              >
                Chat
              </button>
              <button
                type="button"
                className={cs("top-nav-link", {
                  "top-nav-link-active": showPlan,
                })}
                onClick={() => setShowPlan(true)}
              >
                Plan{session.plan?.length ? ` (${session.plan.length})` : ""}
              </button>
            </div>
            <div className="top-nav-actions">
              <span
                className={cs("chip", {
                  "chip-mode-ask": session.mode === "ask",
                  "chip-mode-plan": session.mode === "plan",
                  "chip-mode-build": session.mode === "build",
                })}
              >
                {session.mode}
              </span>
              <span className="chip">{live ? "Synced" : "Offline"}</span>
              <button
                type="button"
                className="top-nav-icon-btn"
                title="New chat"
                onClick={() => void newSession()}
              >
                +
              </button>
            </div>
          </div>
        </header>

        <div className="main-body">
          <section className="main">
            {!live ? (
              <div className="banner banner-danger history-banner">
                Bridge not connected. Run <code>npm run bridge</code>, then
                click a session on the left or &quot;Connect live grok&quot;.
                History is kept and can continue.
              </div>
            ) : null}
            {session.status === "waiting_permission" ? (
              <div className="banner banner-warning history-banner">
                Waiting for permission…
              </div>
            ) : null}
            {session.status === "streaming" ? (
              <div className="banner history-banner">Generating response…</div>
            ) : null}
            <TimelineView />
            <ComposerWidget />
          </section>

          {showPlan ? (
            <aside className="rail-right" aria-label="Plan">
              <div className="rail-head">
                <span>Plan</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowPlan(false)}
                >
                  Close
                </button>
              </div>
              <PlanPanelView />
            </aside>
          ) : null}
        </div>
      </div>

      {session.pendingPermission ? <PermissionModalView /> : null}
    </div>
  );
}

function shortWs(workspace: string): string {
  if (!workspace) {return "No workspace";}
  const parts = workspace.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || workspace;
}
