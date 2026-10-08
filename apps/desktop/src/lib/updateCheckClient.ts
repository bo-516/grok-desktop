/**
 * Fetch the latest GitHub release for the update notice.
 *
 * Failures resolve to kind "error" or "none". This function does not throw
 * and does not log: a network problem must stay silent. The browser sets
 * User-Agent; setting it from script is forbidden and GitHub accepts the
 * browser's. api.github.com sends Access-Control-Allow-Origin: * for GET,
 * which is why the webview can call it without a bridge proxy.
 */

import {
  GITHUB_LATEST_RELEASE_URL,
  parseGithubRelease,
  type UpdatePlatform,
} from "@/lib/githubRelease";
import type { FetchReleaseResult } from "@/lib/updateCheck";

/** Abort a hung request. Ten seconds is enough for the releases API. */
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/**
 * GET the latest release and parse it.
 * Non-2xx (including 404 when the repo has no release, and 403 when rate
 * limited) is kind "none": the server answered, so the caller may advance
 * the throttle. A throw or an abort is kind "error" and does not.
 * @param fetchImpl fetch, or a test double. Must match the Fetch signature.
 * @param platform Which zip to attach as the download link.
 * @param url Endpoint. Defaults to bo-516/grok-desktop releases/latest.
 *   Tests pass their own URL. The product path uses the default.
 * @returns A FetchReleaseResult. Never throws.
 */
export async function fetchLatestGithubRelease(
  fetchImpl: typeof fetch,
  platform: UpdatePlatform,
  url: string = GITHUB_LATEST_RELEASE_URL,
): Promise<FetchReleaseResult> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { kind: "none" };
    }
    const body: unknown = await res.json();
    const release = parseGithubRelease(body, platform);
    if (!release) {
      return { kind: "none" };
    }
    return { kind: "release", release };
  } catch {
    return { kind: "error" };
  }
}
