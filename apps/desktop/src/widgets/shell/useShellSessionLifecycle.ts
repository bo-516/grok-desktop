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
import { setAttentionBadge } from "../../lib/dockBadge";
import { useSessionStore } from "../../store/sessionStore";

/**
 * Hydrate catalog, resume last session, refresh env, dock/OS attention badge,
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
  const reconnect = useSessionStore((s) => s.reconnect);
  const ensureConnected = useSessionStore((s) => s.ensureConnected);
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);
  const refreshAuth = useSessionStore((s) => s.refreshAuth);
  const autoStarted = useRef(false);

  useEffect(() => {
    hydrateCatalog();
  }, [hydrateCatalog]);

  useEffect(() => {
    if (autoStarted.current) {
      return;
    }
    autoStarted.current = true;
    const cat = useSessionStore.getState().catalog;
    const last = cat[0];
    if (last) {
      selectSession(last.id);
    } else {
      void reconnect().catch(() => undefined);
    }
  }, [reconnect, selectSession]);

  useEffect(() => {
    if (args.connectionMode === "live-bridge") {
      refreshEnvironment();
    }
  }, [args.connectionMode, refreshEnvironment]);

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
