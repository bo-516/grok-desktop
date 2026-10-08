/**
 * Throttle, dismiss, and GitHub payload decisions for the update notice.
 * Fetch is injected. No localStorage and no network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MACOS_RELEASE_ZIP,
  WINDOWS_RELEASE_ZIP,
  parseGithubRelease,
} from "@/lib/githubRelease";
import {
  applyFetchResult,
  defaultUpdateCheckPrefs,
  mergeUpdateCheckPrefs,
  noticeFromPrefs,
  runStartupUpdateCheck,
  UPDATE_CHECK_INTERVAL_HOURS,
  UPDATE_CHECK_INTERVAL_MS,
  updateQueryDecision,
  type FetchReleaseResult,
  type UpdateCheckPrefs,
} from "@/lib/updateCheck";
import { fetchLatestGithubRelease } from "@/lib/updateCheckClient";

/** Six hours, in ms. Tests fail if the copy constant drifts from the window. */
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** Fixed clock so throttle math does not depend on the test runner's time. */
const NOW = 1_700_000_000_000;

const NOTES = "https://github.com/bo-516/grok-desktop/releases/tag/v0.3.0";
const MAC_ZIP =
  "https://github.com/bo-516/grok-desktop/releases/download/v0.3.0/Grok-Desktop-macos-universal.zip";
const WIN_ZIP =
  "https://github.com/bo-516/grok-desktop/releases/download/v0.3.0/Grok-Desktop-windows-amd64.zip";

/**
 * Prefs with a cached 0.3.0 release. Other fields come from the argument.
 * @param patch Fields that differ from the defaults plus this cache.
 * @returns A full prefs object.
 */
function prefsWithCache(
  patch: Partial<UpdateCheckPrefs> = {},
): UpdateCheckPrefs {
  return {
    ...defaultUpdateCheckPrefs(),
    cached: {
      version: "0.3.0",
      notesUrl: NOTES,
      downloadUrl: MAC_ZIP,
    },
    ...patch,
  };
}

/** GitHub latest-release body with both desktop zips. */
function releaseBody(tag: string): Record<string, unknown> {
  return {
    tag_name: tag,
    html_url: NOTES,
    assets: [
      { name: MACOS_RELEASE_ZIP, browser_download_url: MAC_ZIP },
      { name: WINDOWS_RELEASE_ZIP, browser_download_url: WIN_ZIP },
    ],
  };
}

describe("update check interval", () => {
  it("keeps the hours constant equal to the millisecond window", () => {
    assert.equal(
      UPDATE_CHECK_INTERVAL_HOURS * 60 * 60 * 1000,
      UPDATE_CHECK_INTERVAL_MS,
    );
    assert.equal(UPDATE_CHECK_INTERVAL_MS, SIX_HOURS_MS);
  });
});

describe("updateQueryDecision", () => {
  it("skips when disabled", () => {
    const prefs = { ...defaultUpdateCheckPrefs(), enabled: false };
    assert.deepEqual(updateQueryDecision(prefs, NOW, SIX_HOURS_MS), {
      query: false,
      reason: "disabled",
    });
  });

  it("queries when there has never been a check", () => {
    assert.deepEqual(
      updateQueryDecision(defaultUpdateCheckPrefs(), NOW, SIX_HOURS_MS),
      { query: true },
    );
  });

  it("throttles inside the window and queries once it has elapsed", () => {
    const prefs = { ...defaultUpdateCheckPrefs(), lastCheckedAt: NOW - 1000 };
    assert.deepEqual(updateQueryDecision(prefs, NOW, SIX_HOURS_MS), {
      query: false,
      reason: "throttled",
    });
    const elapsed = {
      ...defaultUpdateCheckPrefs(),
      lastCheckedAt: NOW - SIX_HOURS_MS,
    };
    assert.deepEqual(updateQueryDecision(elapsed, NOW, SIX_HOURS_MS), {
      query: true,
    });
  });

  it("queries when the stored timestamp is in the future", () => {
    const prefs = { ...defaultUpdateCheckPrefs(), lastCheckedAt: NOW + 60_000 };
    assert.deepEqual(updateQueryDecision(prefs, NOW, SIX_HOURS_MS), {
      query: true,
    });
  });
});

describe("noticeFromPrefs", () => {
  it("shows a newer cached release", () => {
    const notice = noticeFromPrefs(prefsWithCache(), "0.2.1");
    assert.deepEqual(notice, {
      version: "0.3.0",
      notesUrl: NOTES,
      downloadUrl: MAC_ZIP,
    });
  });

  it("hides when the cache is not newer, checks are off, or the version was dismissed", () => {
    assert.equal(noticeFromPrefs(prefsWithCache(), "0.3.0"), null);
    assert.equal(noticeFromPrefs(prefsWithCache(), "0.4.0"), null);
    assert.equal(
      noticeFromPrefs(prefsWithCache({ enabled: false }), "0.2.1"),
      null,
    );
    assert.equal(
      noticeFromPrefs(prefsWithCache({ dismissedVersion: "0.3.0" }), "0.2.1"),
      null,
    );
    assert.equal(
      noticeFromPrefs(prefsWithCache({ dismissedVersion: "v0.3.0" }), "0.2.1"),
      null,
    );
    const newer = noticeFromPrefs(
      prefsWithCache({ dismissedVersion: "0.2.0" }),
      "0.2.1",
    );
    assert.equal(newer?.version, "0.3.0");
  });

  it("hides when the running version does not parse", () => {
    assert.equal(noticeFromPrefs(prefsWithCache(), "latest"), null);
  });
});

describe("applyFetchResult", () => {
  it("does not move the throttle on a transport error", () => {
    const prefs = defaultUpdateCheckPrefs();
    const next = applyFetchResult(prefs, { kind: "error" }, NOW);
    assert.equal(next, prefs);
    assert.equal(next.lastCheckedAt, null);
  });

  it("advances the throttle on an empty HTTP response and keeps the cache", () => {
    const prefs = prefsWithCache();
    const next = applyFetchResult(prefs, { kind: "none" }, NOW);
    assert.equal(next.lastCheckedAt, NOW);
    assert.equal(next.cached, prefs.cached);
  });

  it("stores a parsed release and the check time", () => {
    const release = {
      version: "0.4.0",
      notesUrl: NOTES,
      downloadUrl: MAC_ZIP,
    };
    const next = applyFetchResult(
      defaultUpdateCheckPrefs(),
      { kind: "release", release },
      NOW,
    );
    assert.equal(next.lastCheckedAt, NOW);
    assert.deepEqual(next.cached, release);
  });
});

describe("mergeUpdateCheckPrefs", () => {
  it("keeps a dismiss that happened while the request was in flight", () => {
    const disk = prefsWithCache({ dismissedVersion: "0.4.0", enabled: false });
    const checked = prefsWithCache({
      lastCheckedAt: NOW,
      cached: {
        version: "0.4.0",
        notesUrl: NOTES,
        downloadUrl: WIN_ZIP,
      },
    });
    const merged = mergeUpdateCheckPrefs(disk, checked);
    assert.equal(merged.enabled, false);
    assert.equal(merged.dismissedVersion, "0.4.0");
    assert.equal(merged.lastCheckedAt, NOW);
    assert.equal(merged.cached?.downloadUrl, WIN_ZIP);
  });
});

describe("parseGithubRelease", () => {
  it("picks the platform zip and canonicalizes the tag", () => {
    const mac = parseGithubRelease(releaseBody("v0.3.0"), "mac");
    assert.equal(mac?.version, "0.3.0");
    assert.equal(mac?.downloadUrl, MAC_ZIP);
    assert.equal(mac?.notesUrl, NOTES);
    const win = parseGithubRelease(releaseBody("v0.3.0"), "windows");
    assert.equal(win?.downloadUrl, WIN_ZIP);
  });

  it("falls back when an asset URL is off-host or the platform has no zip", () => {
    const body = releaseBody("v0.3.0");
    body.assets = [
      {
        name: MACOS_RELEASE_ZIP,
        browser_download_url: "https://evil.example/payload.zip",
      },
    ];
    body.html_url = "https://evil.example/notes";
    const parsed = parseGithubRelease(body, "mac");
    assert.equal(
      parsed?.notesUrl,
      "https://github.com/bo-516/grok-desktop/releases/tag/v0.3.0",
    );
    assert.equal(
      parsed?.downloadUrl,
      `https://github.com/bo-516/grok-desktop/releases/latest/download/${MACOS_RELEASE_ZIP}`,
    );
    const other = parseGithubRelease(releaseBody("0.3.0"), "other");
    assert.equal(
      other?.downloadUrl,
      "https://github.com/bo-516/grok-desktop/releases/tag/v0.3.0",
    );
  });

  it("returns null for a missing or unparseable tag", () => {
    assert.equal(parseGithubRelease(null, "mac"), null);
    assert.equal(parseGithubRelease({ tag_name: "nightly" }, "mac"), null);
    assert.equal(parseGithubRelease({}, "mac"), null);
  });
});

describe("runStartupUpdateCheck", () => {
  it("does not fetch while throttled and still shows a cached newer release", async () => {
    let calls = 0;
    const fetchRelease = (): Promise<FetchReleaseResult> => {
      calls += 1;
      return Promise.resolve({ kind: "error" });
    };
    const prefs = prefsWithCache({ lastCheckedAt: NOW - 1000 });
    const result = await runStartupUpdateCheck({
      prefs,
      now: NOW,
      currentVersion: "0.2.1",
      intervalMs: SIX_HOURS_MS,
      fetchRelease,
    });
    assert.equal(calls, 0);
    assert.equal(result.persist, false);
    assert.equal(result.notice?.version, "0.3.0");
  });

  it("persists a newer release and shows it", async () => {
    const fetched: FetchReleaseResult = {
      kind: "release",
      release: {
        version: "0.9.0",
        notesUrl: NOTES,
        downloadUrl: MAC_ZIP,
      },
    };
    const result = await runStartupUpdateCheck({
      prefs: defaultUpdateCheckPrefs(),
      now: NOW,
      currentVersion: "0.2.1",
      intervalMs: SIX_HOURS_MS,
      fetchRelease: () => Promise.resolve(fetched),
    });
    assert.equal(result.persist, true);
    assert.equal(result.prefs.lastCheckedAt, NOW);
    assert.equal(result.notice?.version, "0.9.0");
  });

  it("stays quiet and does not persist when the transport fails", async () => {
    const prefs = defaultUpdateCheckPrefs();
    const result = await runStartupUpdateCheck({
      prefs,
      now: NOW,
      currentVersion: "0.2.1",
      intervalMs: SIX_HOURS_MS,
      fetchRelease: () => Promise.resolve({ kind: "error" }),
    });
    assert.equal(result.persist, false);
    assert.equal(result.notice, null);
    assert.equal(result.prefs.lastCheckedAt, null);
  });

  it("persists a completed empty response without showing a notice", async () => {
    const result = await runStartupUpdateCheck({
      prefs: defaultUpdateCheckPrefs(),
      now: NOW,
      currentVersion: "0.2.1",
      intervalMs: SIX_HOURS_MS,
      fetchRelease: () => Promise.resolve({ kind: "none" }),
    });
    assert.equal(result.persist, true);
    assert.equal(result.prefs.lastCheckedAt, NOW);
    assert.equal(result.notice, null);
  });

  it("does not fetch when checks are disabled", async () => {
    let calls = 0;
    const result = await runStartupUpdateCheck({
      prefs: prefsWithCache({ enabled: false }),
      now: NOW,
      currentVersion: "0.2.1",
      intervalMs: SIX_HOURS_MS,
      fetchRelease: () => {
        calls += 1;
        return Promise.resolve({ kind: "error" });
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.notice, null);
    assert.equal(result.persist, false);
  });
});

describe("fetchLatestGithubRelease", () => {
  it("parses a 200 body", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(releaseBody("v1.2.3")), {
        status: 200,
      })) as typeof fetch;
    const result = await fetchLatestGithubRelease(fetchImpl, "mac", "https://example.test/latest");
    assert.equal(result.kind, "release");
    if (result.kind !== "release") {
      return;
    }
    assert.equal(result.release.version, "1.2.3");
    assert.equal(result.release.downloadUrl, MAC_ZIP);
  });

  it("treats a non-2xx response as none", async () => {
    const fetchImpl = (async () =>
      new Response("missing", { status: 404 })) as typeof fetch;
    const result = await fetchLatestGithubRelease(fetchImpl, "mac", "https://example.test/latest");
    assert.deepEqual(result, { kind: "none" });
  });

  it("treats a thrown fetch as error", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const result = await fetchLatestGithubRelease(fetchImpl, "windows", "https://example.test/latest");
    assert.deepEqual(result, { kind: "error" });
  });
});
