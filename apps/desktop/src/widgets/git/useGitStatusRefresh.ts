/**
 * Event-driven git status refresh for the active workspace. Triggers:
 * workspace / bridge change (session switch, reconnect), a turn settling
 * (agent stopped editing), and window focus (edits made in an editor or a
 * terminal). Git actions refresh on their own. There is deliberately no
 * polling interval.
 */

import { useEffect, useRef } from "react";
import { focusRefreshDue, isTurnSettleEdge } from "@/lib/gitPanelModel";
import { useGitStore } from "@/store/gitStore";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Keep `useGitStore.byCwd[cwd]` fresh. Mount once (the top-nav chip owns it).
 * @param cwd Absolute workspace of the session on screen ("" disables).
 */
export function useGitStatusRefresh(cwd: string): void {
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  /** Live handle identity: a reconnect hands out a new one. */
  const live = useSessionStore((s) => s.live);
  const status = useSessionStore((s) => s.session.status);
  /** Previous session status, for the busy → idle edge. */
  const prevStatusRef = useRef<typeof status | null>(null);
  /** Epoch ms of the last focus-triggered refresh (throttle). */
  const lastFocusRef = useRef(0);

  useEffect(() => {
    if (cwd && live) {
      void refreshStatus(cwd);
    }
  }, [cwd, live, refreshStatus]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (cwd && isTurnSettleEdge(prev, status)) {
      void refreshStatus(cwd);
    }
  }, [cwd, status, refreshStatus]);

  useEffect(() => {
    if (!cwd || typeof window === "undefined") {
      return;
    }
    const onFocus = () => {
      const now = Date.now();
      if (!focusRefreshDue(lastFocusRef.current, now)) {
        return;
      }
      lastFocusRef.current = now;
      void refreshStatus(cwd);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [cwd, refreshStatus]);
}
