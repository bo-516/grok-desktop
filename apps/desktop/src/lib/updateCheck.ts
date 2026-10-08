/**
 * Pure update-check decisions: throttle, dismiss, and whether to show a notice.
 *
 * No network and no localStorage. The widget loads prefs, calls
 * runStartupUpdateCheck with an injected fetch, and persists the result.
 * Network failures stay silent because a fetch error does not set `persist`,
 * so the caller keeps the previous prefs and shows nothing new.
 */

import type { ParsedRelease } from "@/lib/githubRelease";
import {
  canonicalSemver,
  isNewerVersion,
} from "@/lib/updateSemver";

/**
 * How often a startup may query GitHub. Six hours is well under the
 * unauthenticated 60 requests/hour limit even if several people share an IP.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Same window as UPDATE_CHECK_INTERVAL_MS, for settings copy.
 * Tests assert the two stay in sync.
 */
export const UPDATE_CHECK_INTERVAL_HOURS = 6;

/** Banner contents. Fields match a parsed GitHub release. */
export type UpdateNotice = ParsedRelease;

/**
 * Persisted update-check preferences.
 * `enabled` false skips the network and hides any cached notice.
 * `dismissedVersion` is a canonical semver; that version stays hidden until
 * a strictly newer tag appears.
 * `lastCheckedAt` is epoch milliseconds of the last completed HTTP round
 * trip. Transport failures do not write it, so the next launch retries.
 * `cached` is the last release payload we accepted, newer or not.
 */
export type UpdateCheckPrefs = {
  /** When false, no query and no banner. Default true. */
  enabled: boolean;
  /** Canonical version the user dismissed, or null. */
  dismissedVersion: string | null;
  /** Epoch ms of the last HTTP response, or null if we have never finished one. */
  lastCheckedAt: number | null;
  /** Last accepted release, or null. */
  cached: ParsedRelease | null;
};

/**
 * Outcome of one latest-release fetch.
 * "error" is timeout, network, or a thrown fetch. "none" is an HTTP
 * response that did not yield a release (404, rate limit, bad JSON).
 * "release" is a parsed body. Only "error" leaves the throttle unchanged.
 */
export type FetchReleaseResult =
  | { kind: "release"; release: ParsedRelease }
  | { kind: "none" }
  | { kind: "error" };

/** What runStartupUpdateCheck returns to the widget. */
export type StartupUpdateCheckResult = {
  /** Prefs to store when persist is true. Unchanged from the input otherwise. */
  prefs: UpdateCheckPrefs;
  /** Notice for the current prefs after the check. Null hides the banner. */
  notice: UpdateNotice | null;
  /**
   * True when an HTTP round trip finished and the caller should write prefs.
   * False when the check was skipped or the transport failed.
   */
  persist: boolean;
};

/**
 * Default prefs: checks on, nothing dismissed, nothing cached.
 * @returns A fresh object. Callers may mutate the result, not a shared constant.
 */
export function defaultUpdateCheckPrefs(): UpdateCheckPrefs {
  return {
    enabled: true,
    dismissedVersion: null,
    lastCheckedAt: null,
    cached: null,
  };
}

/**
 * Decide whether this startup should hit the network.
 * A lastCheckedAt in the future (clock step, corrupt value) is treated as
 * stale so a bad timestamp cannot silence checks forever.
 * @param prefs Current prefs. Disabled always skips.
 * @param now Epoch ms.
 * @param intervalMs Minimum gap between completed checks. Values <= 0 always query.
 * @returns query true, or query false with disabled / throttled.
 */
export function updateQueryDecision(
  prefs: UpdateCheckPrefs,
  now: number,
  intervalMs: number,
): { query: true } | { query: false; reason: "disabled" | "throttled" } {
  if (!prefs.enabled) {
    return { query: false, reason: "disabled" };
  }
  if (prefs.lastCheckedAt == null || prefs.lastCheckedAt > now) {
    return { query: true };
  }
  if (now - prefs.lastCheckedAt < intervalMs) {
    return { query: false, reason: "throttled" };
  }
  return { query: true };
}

/**
 * Notice for the current prefs, ignoring the network.
 * Hidden when checks are off, nothing is cached, the cache is not newer
 * than the running version, either version does not parse, or the user
 * dismissed this canonical version.
 * @param prefs Prefs including the cached release.
 * @param currentVersion Running app version (leading v is accepted).
 * @returns The banner payload, or null.
 */
export function noticeFromPrefs(
  prefs: UpdateCheckPrefs,
  currentVersion: string,
): UpdateNotice | null {
  if (!prefs.enabled || !prefs.cached) {
    return null;
  }
  const latest = canonicalSemver(prefs.cached.version);
  const current = canonicalSemver(currentVersion);
  if (!latest || !current) {
    return null;
  }
  if (!isNewerVersion(latest, current)) {
    return null;
  }
  const dismissed = prefs.dismissedVersion
    ? canonicalSemver(prefs.dismissedVersion)
    : null;
  if (dismissed && dismissed === latest) {
    return null;
  }
  return {
    version: latest,
    notesUrl: prefs.cached.notesUrl,
    downloadUrl: prefs.cached.downloadUrl,
  };
}

/**
 * Fold a fetch result into prefs.
 * "error" returns the same object. "none" advances lastCheckedAt and keeps
 * the previous cache. "release" advances lastCheckedAt and replaces the cache.
 * @param prefs Prefs from before the request.
 * @param result Fetch outcome.
 * @param now Epoch ms written into lastCheckedAt on HTTP success.
 * @returns Next prefs. The error path returns `prefs` unchanged.
 */
export function applyFetchResult(
  prefs: UpdateCheckPrefs,
  result: FetchReleaseResult,
  now: number,
): UpdateCheckPrefs {
  if (result.kind === "error") {
    return prefs;
  }
  if (result.kind === "none") {
    return { ...prefs, lastCheckedAt: now };
  }
  return {
    ...prefs,
    lastCheckedAt: now,
    cached: result.release,
  };
}

/**
 * Keep a dismiss or an enable toggle that landed while the request was in flight.
 * Cache and lastCheckedAt come from the check. Enabled and dismissedVersion
 * come from whatever is on disk now.
 * @param disk Prefs read after the request (user edits win).
 * @param checked Prefs returned by applyFetchResult.
 * @returns Merged prefs. Does not read storage itself.
 */
export function mergeUpdateCheckPrefs(
  disk: UpdateCheckPrefs,
  checked: UpdateCheckPrefs,
): UpdateCheckPrefs {
  return {
    enabled: disk.enabled,
    dismissedVersion: disk.dismissedVersion,
    lastCheckedAt: checked.lastCheckedAt,
    cached: checked.cached,
  };
}

/**
 * One startup check. Does not touch storage or the clock; both are arguments.
 * @param args.prefs Prefs at start. Not mutated.
 * @param args.now Epoch ms for the throttle and for lastCheckedAt.
 * @param args.currentVersion Running app version.
 * @param args.intervalMs Throttle window. Pass UPDATE_CHECK_INTERVAL_MS.
 * @param args.fetchRelease Injected request. Must not throw; return kind "error".
 * @returns Next prefs, the notice to show, and whether the caller should persist.
 */
export async function runStartupUpdateCheck(args: {
  prefs: UpdateCheckPrefs;
  now: number;
  currentVersion: string;
  intervalMs: number;
  fetchRelease: () => Promise<FetchReleaseResult>;
}): Promise<StartupUpdateCheckResult> {
  const decision = updateQueryDecision(args.prefs, args.now, args.intervalMs);
  if (!decision.query) {
    return {
      prefs: args.prefs,
      notice: noticeFromPrefs(args.prefs, args.currentVersion),
      persist: false,
    };
  }
  const fetched = await args.fetchRelease();
  if (fetched.kind === "error") {
    return {
      prefs: args.prefs,
      notice: noticeFromPrefs(args.prefs, args.currentVersion),
      persist: false,
    };
  }
  const prefs = applyFetchResult(args.prefs, fetched, args.now);
  return {
    prefs,
    notice: noticeFromPrefs(prefs, args.currentVersion),
    persist: true,
  };
}
