/**
 * Parse a GitHub "latest release" JSON body into the links the notice opens.
 *
 * Only https URLs on GitHub hosts are kept. A hostile or unexpected host
 * falls back to the public release page for this repo, so a bad payload
 * cannot steer the browser at an arbitrary site. Asset names match the
 * files scripts/build-release.sh writes.
 */

import { canonicalSemver } from "@/lib/updateSemver";

/** owner/name queried by the update check. */
export const UPDATE_CHECK_REPO = "bo-516/grok-desktop";

/** GET URL for the latest non-draft, non-prerelease GitHub release. */
export const GITHUB_LATEST_RELEASE_URL =
  `https://api.github.com/repos/${UPDATE_CHECK_REPO}/releases/latest`;

/** Zip name the macOS release script writes. */
export const MACOS_RELEASE_ZIP = "Grok-Desktop-macos-universal.zip";

/** Zip name the Windows release script writes. */
export const WINDOWS_RELEASE_ZIP = "Grok-Desktop-windows-amd64.zip";

/** Public releases index used when the API omits a safe URL. */
const RELEASES_PAGE = `https://github.com/${UPDATE_CHECK_REPO}/releases`;

/** Hosts allowed for the release-notes link. */
const NOTES_HOSTS = new Set(["github.com"]);

/**
 * Hosts allowed for a browser download. GitHub redirects asset downloads
 * through the objects / release-assets hosts.
 */
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

/** Which desktop zip to offer. "other" links at the release page. */
export type UpdatePlatform = "mac" | "windows" | "other";

/**
 * One release the notice can show. `version` is canonical (no leading v).
 */
export type ParsedRelease = {
  /** Canonical semver of the tag. */
  version: string;
  /** https release page (notes). */
  notesUrl: string;
  /** https zip, or the release page when the platform has no zip. */
  downloadUrl: string;
};

/**
 * Pick a desktop platform from a user agent.
 * Macintosh is required for mac so an iPhone "like Mac OS X" token does
 * not count. This app does not ship an iOS build.
 * @param userAgent navigator.userAgent, or "" when there is no navigator.
 * @returns mac, windows, or other.
 */
export function detectUpdatePlatform(userAgent: string): UpdatePlatform {
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }
  if (/Macintosh/i.test(userAgent)) {
    return "mac";
  }
  return "other";
}

/**
 * Keep an https URL whose host is in the allow-list.
 * @param raw Value from JSON. Non-strings and other schemes return null.
 * @param hosts Allowed hostnames, exact match.
 * @returns The href, or null.
 */
export function httpsAllowlistedUrl(
  raw: unknown,
  hosts: ReadonlySet<string>,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (!hosts.has(parsed.hostname)) {
    return null;
  }
  return parsed.href;
}

/**
 * True when a stored notes or download URL is still safe to open.
 * @param raw URL string from localStorage.
 * @param kind notes (github.com only) or download (asset hosts too).
 * @returns false for anything that is not an allow-listed https URL.
 */
export function isAllowedReleaseUrl(
  raw: string,
  kind: "notes" | "download",
): boolean {
  const hosts = kind === "notes" ? NOTES_HOSTS : DOWNLOAD_HOSTS;
  return httpsAllowlistedUrl(raw, hosts) === raw;
}

/**
 * Zip file name for a platform, or null when we should open the release page.
 * @param platform Result of detectUpdatePlatform.
 * @returns The release zip name, or null for "other".
 */
function assetNameForPlatform(platform: UpdatePlatform): string | null {
  if (platform === "mac") {
    return MACOS_RELEASE_ZIP;
  }
  if (platform === "windows") {
    return WINDOWS_RELEASE_ZIP;
  }
  return null;
}

/**
 * Release-notes URL. Falls back to the tag page when html_url is missing
 * or points somewhere other than github.com.
 * @param htmlUrl API html_url field.
 * @param version Canonical semver, used in the fallback path.
 * @returns Always an https github.com URL.
 */
function pickNotesUrl(htmlUrl: unknown, version: string): string {
  const safe = httpsAllowlistedUrl(htmlUrl, NOTES_HOSTS);
  if (safe) {
    return safe;
  }
  return `${RELEASES_PAGE}/tag/v${version}`;
}

/**
 * Download URL for the platform's zip. A matching asset with a safe
 * browser_download_url wins. Otherwise the stable latest/download URL,
 * which GitHub resolves to the current release's asset. "other" uses the
 * tag page.
 * @param assets API assets array. Non-arrays are ignored.
 * @param platform Which zip to look for.
 * @param version Canonical semver, used when there is no zip.
 * @returns Always an allow-listed https URL.
 */
function pickDownloadUrl(
  assets: unknown,
  platform: UpdatePlatform,
  version: string,
): string {
  const wanted = assetNameForPlatform(platform);
  if (wanted && Array.isArray(assets)) {
    for (const item of assets) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      if (rec.name !== wanted) {
        continue;
      }
      const safe = httpsAllowlistedUrl(rec.browser_download_url, DOWNLOAD_HOSTS);
      if (safe) {
        return safe;
      }
    }
  }
  if (wanted) {
    return `${RELEASES_PAGE}/latest/download/${wanted}`;
  }
  return `${RELEASES_PAGE}/tag/v${version}`;
}

/**
 * Parse the GitHub latest-release JSON.
 * Drafts and prereleases are not returned by that endpoint; this function
 * still accepts a prerelease tag if one is handed to it.
 * @param payload JSON value. Anything other than an object with a parseable
 *   tag_name returns null (caller treats that as "no release", not a throw).
 * @param platform Which download link to attach.
 * @returns Parsed release, or null when the tag is missing or not semver.
 */
export function parseGithubRelease(
  payload: unknown,
  platform: UpdatePlatform,
): ParsedRelease | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const rec = payload as Record<string, unknown>;
  if (typeof rec.tag_name !== "string") {
    return null;
  }
  const version = canonicalSemver(rec.tag_name);
  if (!version) {
    return null;
  }
  return {
    version,
    notesUrl: pickNotesUrl(rec.html_url, version),
    downloadUrl: pickDownloadUrl(rec.assets, platform, version),
  };
}
