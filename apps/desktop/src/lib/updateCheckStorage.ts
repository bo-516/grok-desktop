/**
 * localStorage for the update check.
 *
 * One JSON blob. A corrupt or hostile value falls back to defaults so a
 * bad write cannot crash startup or open an off-site URL. Writes dispatch
 * grok-desktop:update-check-changed so the banner and the settings toggle
 * stay in step without a shared store.
 */

import { isAllowedReleaseUrl, type ParsedRelease } from "@/lib/githubRelease";
import {
  defaultUpdateCheckPrefs,
  type UpdateCheckPrefs,
} from "@/lib/updateCheck";
import { canonicalSemver } from "@/lib/updateSemver";

/** localStorage key. v1 is the JSON shape in parseStoredUpdateCheck. */
export const UPDATE_CHECK_STORAGE_KEY = "grok-desktop.updateCheck.v1";

/**
 * Fired after a successful write. No detail payload; listeners re-read storage.
 * Same prefix as the theme event so shell listeners stay recognizable.
 */
export const UPDATE_CHECK_CHANGED_EVENT = "grok-desktop:update-check-changed";

/**
 * Read a cached release only when its version parses and both URLs are
 * still on the GitHub allow-list.
 * @param raw JSON cached field.
 * @returns The release, or null when any field is missing or unsafe.
 */
function parseCached(raw: unknown): ParsedRelease | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.version !== "string") {
    return null;
  }
  const version = canonicalSemver(rec.version);
  if (!version) {
    return null;
  }
  if (typeof rec.notesUrl !== "string" || typeof rec.downloadUrl !== "string") {
    return null;
  }
  if (!isAllowedReleaseUrl(rec.notesUrl, "notes")) {
    return null;
  }
  if (!isAllowedReleaseUrl(rec.downloadUrl, "download")) {
    return null;
  }
  return {
    version,
    notesUrl: rec.notesUrl,
    downloadUrl: rec.downloadUrl,
  };
}

/**
 * Parse the stored JSON blob.
 * Only an explicit false disables checks; a missing flag stays on.
 * @param raw localStorage string, or null when the key is absent.
 * @returns Prefs. Malformed JSON returns defaults.
 */
export function parseStoredUpdateCheck(raw: string | null): UpdateCheckPrefs {
  if (!raw) {
    return defaultUpdateCheckPrefs();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultUpdateCheckPrefs();
  }
  if (!parsed || typeof parsed !== "object") {
    return defaultUpdateCheckPrefs();
  }
  const rec = parsed as Record<string, unknown>;
  const enabled = rec.enabled !== false;
  let dismissedVersion: string | null = null;
  if (typeof rec.dismissedVersion === "string") {
    dismissedVersion = canonicalSemver(rec.dismissedVersion);
  }
  let lastCheckedAt: number | null = null;
  if (typeof rec.lastCheckedAt === "number" && Number.isFinite(rec.lastCheckedAt)) {
    lastCheckedAt = rec.lastCheckedAt;
  }
  return {
    enabled,
    dismissedVersion,
    lastCheckedAt,
    cached: parseCached(rec.cached),
  };
}

/**
 * Load prefs. Missing storage (unit tests, private mode) returns defaults.
 * @returns Prefs. Never throws.
 */
export function loadUpdateCheckPrefs(): UpdateCheckPrefs {
  if (typeof localStorage === "undefined") {
    return defaultUpdateCheckPrefs();
  }
  try {
    return parseStoredUpdateCheck(localStorage.getItem(UPDATE_CHECK_STORAGE_KEY));
  } catch {
    return defaultUpdateCheckPrefs();
  }
}

/**
 * Persist prefs and tell listeners. A storage failure (quota, private mode)
 * skips the event so the UI does not pretend the write landed.
 * @param prefs Next prefs. Replaced wholesale; pass a full object.
 */
export function saveUpdateCheckPrefs(prefs: UpdateCheckPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(UPDATE_CHECK_CHANGED_EVENT));
}

/**
 * Toggle startup checks. Other fields are left as stored.
 * @param enabled Next value. false hides the banner on the next event.
 */
export function setUpdateCheckEnabled(enabled: boolean): void {
  const prefs = loadUpdateCheckPrefs();
  saveUpdateCheckPrefs({ ...prefs, enabled });
}

/**
 * Remember a dismissed release. A string that is not semver is ignored so
 * a bad click cannot stick a garbage token in the blob.
 * @param version Version shown on the banner (canonical or with a leading v).
 */
export function dismissUpdateVersion(version: string): void {
  const canonical = canonicalSemver(version);
  if (!canonical) {
    return;
  }
  const prefs = loadUpdateCheckPrefs();
  saveUpdateCheckPrefs({ ...prefs, dismissedVersion: canonical });
}
