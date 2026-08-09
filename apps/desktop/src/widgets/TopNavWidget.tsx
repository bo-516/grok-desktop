/**
 * Slim top chrome (IA): session identity + sync + context-rail toggle + session ⋯.
 * Mode lives in Composer; drawers live in sidebar footer + ⌘K.
 */

import cs from "classnames";
import { useSessionStore } from "../store/sessionStore";
import { SessionMenuWidget } from "./SessionMenuWidget";

export type TopNavWidgetProps = {
  /** Session display title. */
  title: string;
  /** Compact sync chip label (Synced / Generating / Offline). */
  syncLabel: string;
  /** Live bridge connected. */
  live: boolean;
  /** Whether the context rail is open (aria-pressed on ⧉). */
  contextRailOpen: boolean;
  /** Plan step count for the context-rail badge (0 hides badge). */
  planCount: number;
  /** Toggle right context rail (plan). */
  onToggleContextRail: () => void;
  /** Open rewind confirm. */
  onRequestRewind: () => void;
  /** Request delete confirm for a session. */
  onRequestDelete: (id: string, title: string) => void;
  /**
   * Open/close session rail overlay on narrow viewports (max-sm).
   * Missing handler hides the rail toggle (desktop dock always visible).
   */
  onToggleRail?: () => void;
  /** Whether the mobile rail overlay is open (aria-expanded). */
  railOpen?: boolean;
};

/**
 * Stateful top chrome: title, sync, context rail toggle, session menu.
 * @param props Shell state from useAppShellWidget.
 * @returns Fixed top-nav header.
 */
export function TopNavWidget(props: TopNavWidgetProps) {
  const session = useSessionStore((s) => s.session);
  const badge =
    props.planCount > 0 ? String(props.planCount) : null;

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        {props.onToggleRail ? (
          <button
            type="button"
            className="top-nav-rail-btn"
            title="Sessions"
            aria-label="Open sessions"
            aria-expanded={Boolean(props.railOpen)}
            aria-controls="session-rail"
            onClick={props.onToggleRail}
          >
            ☰
          </button>
        ) : null}
        <span className="top-nav-session-title" title={props.title}>
          {props.title}
        </span>
        <span
          className={cs("top-nav-sync", {
            "top-nav-sync-live":
              props.live && session.status !== "disconnected",
            "top-nav-sync-warn":
              !props.live || session.status === "waiting_permission",
          })}
          title={shortWs(session.workspace)}
        >
          <span className="top-nav-sync-dot" aria-hidden="true" />
          {props.syncLabel}
        </span>
      </div>
      <div className="top-nav-right">
        <div className="top-nav-actions">
          <button
            type="button"
            className={cs("top-nav-icon-btn", "top-nav-context-btn", {
              "top-nav-link-active": props.contextRailOpen,
            })}
            title="Toggle plan / context rail (⌘\\)"
            aria-label="Toggle context rail"
            aria-pressed={props.contextRailOpen}
            aria-controls="context-rail"
            onClick={props.onToggleContextRail}
          >
            <span aria-hidden="true">⧉</span>
            {badge ? (
              <span className="top-nav-context-badge" aria-hidden="true">
                {badge}
              </span>
            ) : null}
          </button>
          <SessionMenuWidget
            onRequestRewind={props.onRequestRewind}
            onRequestDelete={props.onRequestDelete}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Take the last path segment of a workspace for short display.
 * @param workspace Absolute path.
 */
function shortWs(workspace: string): string {
  if (!workspace) {
    return "No workspace";
  }
  const parts = workspace.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || workspace;
}
