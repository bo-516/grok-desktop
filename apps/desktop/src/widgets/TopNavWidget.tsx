/**
 * Slim top chrome (IA): session identity + sync + context-drawer toggle + session ⋯.
 * Mode lives in Composer; drawers live in sidebar footer + ⌘K.
 */

import cs from "classnames";
import {
  displaySessionTitle,
  shortSessionId,
  titleFromSessionState,
} from "@grok-desktop/acp-core";
import { useSessionStore } from "../store/sessionStore";
import { useCopyFeedback } from "./shared";
import { SessionMenuWidget } from "./SessionMenuWidget";

export type TopNavWidgetProps = {
  /** Session display title (catalog). Live state may override Goal leftovers. */
  title: string;
  /** Compact connection chip label (Synced / Awaiting / Offline). */
  syncLabel: string;
  /** Live bridge connected. */
  live: boolean;
  /** Whether the context drawer is open (aria-expanded on ⧉). */
  contextRailOpen: boolean;
  /**
   * True when the open drawer is in push mode — shortens top-nav to the rail edge.
   * When false (closed or overlay), top-nav stays full width.
   */
  pushMode: boolean;
  /** Plan step count for the context-drawer badge (0 hides badge). */
  planCount: number;
  /**
   * Running subagents in the current session (Agents badge contribution).
   * Combined with planCount for the top-nav ⧉ chip.
   */
  runningSubagents?: number;
  /** Toggle right context drawer (plan / agents). */
  onToggleContextRail: () => void;
  /** Open rewind confirm. */
  onRequestRewind: () => void;
  /** Request delete confirm for a session. */
  onRequestDelete: (id: string, title: string) => void;
  /**
   * Open/close the session-rail overlay when the rail is not docked.
   * Missing handler hides the hamburger even in overlay mode.
   */
  onToggleRail?: () => void;
  /** Whether the off-canvas session rail overlay is open (aria-expanded). */
  railOpen?: boolean;
  /**
   * True when the session rail occupies layout space.
   * False shows the hamburger so the user can reopen the overlay list.
   */
  sidebarDocked: boolean;
};

/**
 * Stateful top chrome: title, short session id, sync, context drawer, menu.
 * The sessions hamburger mounts only when the left rail is off-canvas.
 * When viewing a harness subagent, shows a breadcrumb back to the parent.
 * The id chip stays visible when a long Goal path would otherwise eat the bar,
 * so two chats that share a Goal file remain distinguishable.
 * @param props Shell state from useAppShellWidget.
 * @returns Fixed top-nav header.
 */
export function TopNavWidget(props: TopNavWidgetProps) {
  const session = useSessionStore((s) => s.session);
  const viewingSubagent = useSessionStore((s) => s.viewingSubagent);
  const viewingParentSessionId = useSessionStore(
    (s) => s.viewingParentSessionId,
  );
  const selectSession = useSessionStore((s) => s.selectSession);
  const { copiedKey, copy } = useCopyFeedback();
  const running = props.runningSubagents ?? 0;
  const badgeTotal = props.planCount + running;
  const badge = badgeTotal > 0 ? String(badgeTotal) : null;
  const liveTitle = titleFromSessionState(session);
  const conversationTitle = displaySessionTitle(liveTitle || props.title);
  const label = viewingSubagent
    ? `Subagent · ${conversationTitle}`
    : conversationTitle;
  const sessionId = session.id.trim();
  const idChip = shortSessionId(sessionId);
  const idCopied = Boolean(sessionId) && copiedKey === sessionId;

  return (
    <header
      className={cs("top-nav", {
        "top-nav-railed": props.pushMode,
        "top-nav-flush": !props.sidebarDocked,
      })}
    >
      <div className="top-nav-left">
        {!props.sidebarDocked && props.onToggleRail ? (
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
        {viewingSubagent && viewingParentSessionId ? (
          <button
            type="button"
            className="top-nav-back-btn btn-ghost"
            onClick={() => selectSession(viewingParentSessionId)}
            title="Return to parent session"
            aria-label="Return to parent session"
          >
            ← Parent
          </button>
        ) : null}
        <span className="top-nav-session">
          <span
            className="top-nav-session-title"
            title={sessionId ? `${label} · ${sessionId}` : label}
          >
            {label}
          </span>
          {idChip ? (
            <button
              type="button"
              className="top-nav-session-id"
              title={
                idCopied ? "Copied session id" : `Copy session id ${sessionId}`
              }
              aria-label={
                idCopied ? "Session id copied" : `Copy session id ${sessionId}`
              }
              onClick={() => copy(sessionId, sessionId)}
            >
              {idCopied ? "copied" : idChip}
            </button>
          ) : null}
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
            title="Toggle session rail (⌘\\)"
            aria-label="Toggle session rail"
            aria-expanded={props.contextRailOpen}
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
