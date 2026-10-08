/**
 * Startup update check for the shell banner.
 *
 * Reads prefs, shows a cached newer release immediately, and queries GitHub
 * at most once per throttle window. StrictMode mounts the effect twice in
 * dev; both mounts share one in-flight promise so the second does not send
 * a second request. A failed request leaves storage alone.
 */

import { useCallback, useEffect, useState } from "react";
import { readAppVersion } from "@/lib/appVersion";
import { detectUpdatePlatform } from "@/lib/githubRelease";
import {
  mergeUpdateCheckPrefs,
  noticeFromPrefs,
  runStartupUpdateCheck,
  UPDATE_CHECK_INTERVAL_MS,
  type StartupUpdateCheckResult,
  type UpdateNotice,
} from "@/lib/updateCheck";
import { fetchLatestGithubRelease } from "@/lib/updateCheckClient";
import {
  dismissUpdateVersion,
  loadUpdateCheckPrefs,
  saveUpdateCheckPrefs,
  UPDATE_CHECK_CHANGED_EVENT,
} from "@/lib/updateCheckStorage";

/** Banner model. `notice` null means render nothing. */
export type UpdateNoticeWidgetState = {
  /** Release to show, or null when hidden. */
  notice: UpdateNotice | null;
  /** Persist a dismiss for the version currently shown. */
  dismiss: () => void;
};

/**
 * One shared startup request per page load.
 * Reset is not exported: the app mounts this hook once. A second call in
 * the same JS realm (StrictMode) reuses the promise instead of refetching.
 */
let startupCheck: Promise<StartupUpdateCheckResult> | null = null;

/**
 * Run the check once. Later callers in this page load get the same promise.
 * The first call's clock and prefs win; StrictMode's second mount is the
 * same moment, so that is the prefs we want.
 * @param args Arguments for runStartupUpdateCheck.
 * @returns The shared result promise.
 */
function runSharedStartupCheck(
  args: Parameters<typeof runStartupUpdateCheck>[0],
): Promise<StartupUpdateCheckResult> {
  if (!startupCheck) {
    startupCheck = runStartupUpdateCheck(args);
  }
  return startupCheck;
}

/**
 * Entry hook for the update notice. Owns the check and the dismiss write.
 * The widget opens links; this hook does not touch the Wails runtime.
 * @returns The notice to render and a dismiss handler. Notice is null when
 *   checks are off, the cache is not newer, or this version was dismissed.
 */
export function useUpdateNoticeWidget(): UpdateNoticeWidgetState {
  const currentVersion = readAppVersion();
  const [notice, setNotice] = useState<UpdateNotice | null>(() =>
    noticeFromPrefs(loadUpdateCheckPrefs(), currentVersion),
  );

  useEffect(() => {
    let cancelled = false;
    const prefs = loadUpdateCheckPrefs();
    const now = Date.now();
    const platform = detectUpdatePlatform(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
    );
    void runSharedStartupCheck({
      prefs,
      now,
      currentVersion,
      intervalMs: UPDATE_CHECK_INTERVAL_MS,
      fetchRelease: () => fetchLatestGithubRelease(fetch, platform),
    }).then((result) => {
      // A StrictMode throwaway mount must not write prefs. The surviving
      // mount applies the same shared result.
      if (cancelled) {
        return;
      }
      const disk = loadUpdateCheckPrefs();
      const merged = result.persist
        ? mergeUpdateCheckPrefs(disk, result.prefs)
        : disk;
      if (result.persist) {
        saveUpdateCheckPrefs(merged);
      }
      setNotice(noticeFromPrefs(merged, currentVersion));
    });
    const onChanged = () => {
      setNotice(noticeFromPrefs(loadUpdateCheckPrefs(), currentVersion));
    };
    window.addEventListener(UPDATE_CHECK_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATE_CHECK_CHANGED_EVENT, onChanged);
    };
  }, [currentVersion]);

  const dismiss = useCallback(() => {
    if (!notice) {
      return;
    }
    dismissUpdateVersion(notice.version);
  }, [notice]);

  return { notice, dismiss };
}
