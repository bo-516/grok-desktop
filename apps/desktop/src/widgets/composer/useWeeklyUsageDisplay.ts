/**
 * Composer weekly-remaining chip state: Settings pref + billing snapshot.
 * Account billing is polled on its own cadence (not per session turn), which
 * widens while billing keeps failing.
 * Lives here so ComposerWidget can stay a thin assemble layer and
 * useComposerWidget stays under the file-size budget.
 */

import { useEffect, useMemo, useState } from "react";
import {
  buildWeeklyUsageDisplay,
  type WeeklyUsageDisplay,
} from "@/lib/weeklyUsageDisplay";
import {
  loadContextUsagePrefs,
  type ContextUsagePrefs,
} from "@/lib/contextUsagePrefs";
import { startWeeklyUsagePolling } from "@/lib/weeklyUsagePoll";
import { useSessionStore } from "../../store/sessionStore";

/**
 * Subscribe to the Appearance "Show weekly remaining" pref, poll account
 * billing on its own backing-off cadence (not per-turn), and build the chip
 * view-model.
 * Hidden (null) when the pref is off or no snapshot has arrived.
 * @returns Display model when the pref is on and billing parsed; otherwise null.
 */
export function useWeeklyUsageDisplay(): WeeklyUsageDisplay | null {
  const [showWeeklyUsage, setShowWeeklyUsage] = useState(
    () => loadContextUsagePrefs().showWeeklyUsage,
  );
  const weeklyUsage = useSessionStore((s) => s.weeklyUsage);
  const refreshWeeklyUsage = useSessionStore((s) => s.refreshWeeklyUsage);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  /** Resident process that can carry `_x.ai/billing`; data itself is account-level. */
  const sessionId = useSessionStore(
    (s) => s.session.id || s.activeSessionId || s.viewingSessionId,
  );
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<ContextUsagePrefs>).detail;
      if (detail && typeof detail.showWeeklyUsage === "boolean") {
        setShowWeeklyUsage(detail.showWeeklyUsage);
        return;
      }
      setShowWeeklyUsage(loadContextUsagePrefs().showWeeklyUsage);
    };
    window.addEventListener(
      "grok-desktop:context-usage-prefs-changed",
      onPrefs,
    );
    return () =>
      window.removeEventListener(
        "grok-desktop:context-usage-prefs-changed",
        onPrefs,
      );
  }, []);

  useEffect(() => {
    if (!showWeeklyUsage) {
      return;
    }
    if (connectionMode !== "live-bridge" || !sessionId) {
      return;
    }
    return startWeeklyUsagePolling(refreshWeeklyUsage, window);
  }, [showWeeklyUsage, connectionMode, sessionId, refreshWeeklyUsage]);

  return useMemo((): WeeklyUsageDisplay | null => {
    if (!showWeeklyUsage || !weeklyUsage) {
      return null;
    }
    return buildWeeklyUsageDisplay(weeklyUsage);
  }, [showWeeklyUsage, weeklyUsage]);
}
