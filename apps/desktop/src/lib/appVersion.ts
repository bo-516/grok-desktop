/**
 * Product version baked into the desktop bundle.
 *
 * Vite defines __APP_VERSION__ from the repo root package.json (or the
 * VERSION env var). That is the same string scripts/build-release.sh writes
 * into Info.plist and -X main.appVersion. Unit tests run under tsx, where
 * the define is absent; typeof on a missing identifier is "undefined" and
 * does not throw.
 */

/**
 * Dev placeholder when Vite did not inject a version.
 * Matches apps/shell devAppVersion so an unstamped UI and an unstamped shell
 * log the same token.
 */
export const DEV_APP_VERSION = "0.0.0-dev";

/**
 * Read the stamped product semver.
 * @returns The Vite define when it is a non-empty string, otherwise DEV_APP_VERSION.
 */
export function readAppVersion(): string {
  if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0) {
    return __APP_VERSION__;
  }
  return DEV_APP_VERSION;
}
