/**
 * Session bootstrap, environment refresh, and attention notifications.
 * Extracted from useAppShellWidget to keep the shell hook under the line budget.
 */

import { useEffect, useRef } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { setAttentionBadge } from "../../lib/dockBadge";

/**
 * Hydrate catalog, resume last session, refresh env, and dock/OS attention badge.
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
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);
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
