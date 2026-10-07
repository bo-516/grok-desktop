/**
 * Session bootstrap, environment refresh, attention notifications, and the two
 * 3s background loops: auto-reconnect while the bridge is down, login-state
 * poll while it is up (exactly one of them is ever armed).
 * Extracted from useAppShellWidget to keep the shell hook under the line budget.
 */

import { useEffect, useRef } from "react";
import { shouldArmAuthPoll, startAuthPollLoop } from "../../lib/authPoll";
import {
  shouldArmBridgeReconnect,
  startBridgeReconnectLoop,
} from "../../lib/bridgeReconnect";
import { isSubagentSessionKind } from "../../lib/sessionActions";
import { setAttentionBadge } from "../../lib/dockBadge";
import { rememberModelCatalog } from "../../store/modelCatalogStore";
import { useSessionStore } from "../../store/sessionStore";

/**
 * Clear the legacy catalog cache, connect, then open the newest on-disk chat
 * once the first sessions_list lands. Refresh env, dock/OS attention badge,
 * retry the live bridge every 3s while `connectionMode` is disconnected, and
 * re-probe login every 3s while it is live.
 * @param args Session status fields used for notifications and badge count.
 */
export function useShellSessionLifecycle(args: {
  /** Current session runtime status. */
  status: string;
  /** Session title for notification body. */
  title: string | undefined;
  /** Session id for notification body fallback. */
  sessionId: string;
  /** Queued prompt count for dock badge. */
  queueLength: number;
  /** Connection mode for env refresh. */
  connectionMode: string;
}): void {
  const hydrateCatalog = useSessionStore((s) => s.hydrateCatalog);
  const selectSession = useSessionStore((s) => s.selectSession);
  const ensureConnected = useSessionStore((s) => s.ensureConnected);
  const catalogRevision = useSessionStore((s) => s.catalogRevision);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const localDraft = useSessionStore((s) => s.localDraft);
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);
  const refreshAuth = useSessionStore((s) => s.refreshAuth);
  const authed = useSessionStore((s) => s.authed);
  const live = useSessionStore((s) => s.live);
  const autoStarted = useRef(false);
  /** Set once the cold open has chosen a disk chat, or the user acted first. */
  const openedFromDisk = useRef(false);

  useEffect(() => {
    hydrateCatalog();
  }, [hydrateCatalog]);

  useEffect(() => {
    if (autoStarted.current) {
      return;
    }
    autoStarted.current = true;
    // Connect only. Selecting from an empty catalog used to forceNew a ghost chat.
    void ensureConnected().catch(() => undefined);
  }, [ensureConnected]);

  useEffect(() => {
    if (openedFromDisk.current) {
      return;
    }
    if (localDraft || viewingSessionId) {
      openedFromDisk.current = true;
      return;
    }
    if (args.connectionMode !== "live-bridge") {
      return;
    }
    const first = useSessionStore
      .getState()
      .catalog.find((row) => !isSubagentSessionKind(row.sessionKind));
    if (!first) {
      return;
    }
    openedFromDisk.current = true;
    selectSession(first.id);
  }, [
    args.connectionMode,
    catalogRevision,
    localDraft,
    selectSession,
    viewingSessionId,
  ]);

  useEffect(() => {
    if (args.connectionMode === "live-bridge") {
      refreshEnvironment();
    }
  }, [args.connectionMode, refreshEnvironment]);

  // Once per live socket, after login: initialize-only catalog. Does not call
  // session/new, so a New chat does not grow a ghost session. Logged-out
  // initialize often omits models, so wait until authed is true.
  useEffect(() => {
    if (args.connectionMode !== "live-bridge" || authed !== true) {
      return;
    }
    if (!live?.readModelCatalog) {
      return;
    }
    const cwd = useSessionStore.getState().session.workspace || undefined;
    let cancelled = false;
    void live
      .readModelCatalog(cwd)
      .then((reply) => {
        if (cancelled || !reply.ok) {
          return;
        }
        rememberModelCatalog({
          model: reply.model,
          availableModels: reply.availableModels,
          configOptions: reply.configOptions,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [args.connectionMode, authed, live]);

  // Bridge up: re-probe login every 3s. `grok login` completes in a browser
  // and `grok logout` can be run in any terminal — neither notifies us, so the
  // sign-in gate would otherwise stay wrong until the next reconnect.
  useEffect(() => {
    if (!shouldArmAuthPoll(args.connectionMode)) {
      return;
    }
    return startAuthPollLoop(refreshAuth, {
      setInterval: (handler, ms) => window.setInterval(handler, ms),
      clearInterval: (id) => window.clearInterval(id),
    });
  }, [args.connectionMode, refreshAuth]);

  // Bridge down: retry every 3s until live (or the user leaves this screen).
  useEffect(() => {
    if (!shouldArmBridgeReconnect(args.connectionMode)) {
      return;
    }
    return startBridgeReconnectLoop(
      () => ensureConnected(),
      {
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (id) => window.clearInterval(id),
      },
    );
  }, [args.connectionMode, ensureConnected]);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    if (
      args.status === "waiting_permission" ||
      (args.status === "idle" && document.hidden)
    ) {
      if (Notification.permission === "granted") {
        const title =
          args.status === "waiting_permission"
            ? "Grok needs input"
            : "Grok turn finished";
        try {
          new Notification(title, {
            body: args.title || args.sessionId.slice(0, 8),
          });
        } catch {
          /* ignore */
        }
      } else if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
  }, [args.status, args.title, args.sessionId]);

  useEffect(() => {
    const count =
      (args.status === "waiting_permission" ? 1 : 0) + args.queueLength;
    void setAttentionBadge(count, "Grok Desktop");
  }, [args.status, args.queueLength]);
}
