/**
 * grok CLI onboarding rules: step selection, banner action per failure kind,
 * and the text helpers for setup-run output and commands.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EnvironmentInfo } from "@/bridge/liveBridgeTypes";
import type { GrokFailureKind } from "@/bridge/liveBridgeGrokSetupTypes";
import {
  appendRunLog,
  describeSetupExit,
  envBannerAction,
  formatArgv,
  isDeferrableStep,
  onboardingStep,
  stripAnsi,
} from "@/lib/grokOnboarding";

/**
 * Environment snapshot with the given failure kind.
 * @param failureKind Kind to report; "" means ok.
 * @param authed Login flag carried by the probe.
 * @returns A minimal EnvironmentInfo.
 */
function env(failureKind: GrokFailureKind, authed = true): EnvironmentInfo {
  return {
    grokPath: null,
    version: null,
    authed,
    authSource: authed ? "cached_token" : "none",
    authPathChecked: "/h/.grok/auth.json",
    ok: failureKind === "",
    message: `msg:${failureKind}`,
    poolCapacity: 8,
    failureKind,
  };
}

describe("onboardingStep", () => {
  it("shows nothing before any probe and when ready", () => {
    assert.equal(onboardingStep(null, null), null);
    assert.equal(onboardingStep(env(""), true), null);
  });

  it("CLI failures win over login state", () => {
    for (const kind of [
      "not_installed",
      "bin_invalid",
      "too_old",
      "version_unreadable",
      "probe_timeout",
    ] as const) {
      assert.equal(onboardingStep(env(kind, false), false), kind);
      assert.equal(onboardingStep(env(kind, true), true), kind);
    }
  });

  it("signed out waits for the CLI probe before showing sign-in", () => {
    assert.equal(onboardingStep(null, false), "checking");
    assert.equal(onboardingStep(env("signed_out", false), false), "signed_out");
  });

  it("a fresher login tick beats a stale signed_out probe", () => {
    assert.equal(onboardingStep(env("signed_out", false), true), null);
  });

  it("only advisory steps can be set aside", () => {
    assert.equal(isDeferrableStep("too_old"), true);
    assert.equal(isDeferrableStep("probe_timeout"), true);
    assert.equal(isDeferrableStep("version_unreadable"), true);
    assert.equal(isDeferrableStep("not_installed"), false);
    assert.equal(isDeferrableStep("bin_invalid"), false);
    assert.equal(isDeferrableStep("signed_out"), false);
    assert.equal(isDeferrableStep(null), false);
  });
});

describe("envBannerAction", () => {
  it("offers Sign in only for a signed-out CLI", () => {
    assert.deepEqual(envBannerAction(env("signed_out", false)), {
      kind: "login",
      label: "Sign in",
    });
    for (const kind of [
      "not_installed",
      "bin_invalid",
      "too_old",
      "version_unreadable",
      "probe_timeout",
    ] as const) {
      assert.notEqual(envBannerAction(env(kind))?.kind, "login", kind);
    }
  });

  it("maps each CLI failure to its own action", () => {
    assert.equal(envBannerAction(env("probe_timeout"))?.kind, "retry");
    assert.equal(envBannerAction(env("too_old"))?.label, "Update grok…");
    assert.equal(envBannerAction(env("not_installed"))?.kind, "setup");
    assert.equal(envBannerAction(env("bin_invalid"))?.kind, "setup");
  });

  it("no button when ok or unknown; retry for a bridge without kinds", () => {
    assert.equal(envBannerAction(null), null);
    assert.equal(envBannerAction(env("")), null);
    const legacy = { ...env("signed_out"), failureKind: undefined, ok: false };
    assert.equal(envBannerAction(legacy)?.kind, "retry");
  });
});

describe("setup output helpers", () => {
  it("strips color and OSC escapes", () => {
    const esc = String.fromCharCode(0x1b);
    const bel = String.fromCharCode(0x07);
    assert.equal(
      stripAnsi(`${esc}[1;32mok${esc}[0m ${esc}]0;title${bel}done`),
      "ok done",
    );
  });

  it("appends with CR normalization and keeps the tail at a line start", () => {
    assert.equal(appendRunLog("a\n", "b\r\nc\rd"), "a\nb\nc\nd");
    const capped = appendRunLog("line1\nline2\n", "line3\n", 10);
    assert.equal(capped, "line3\n");
  });

  it("quotes argv only where needed", () => {
    assert.equal(
      formatArgv(["bash", "-o", "pipefail", "-c", "curl -fsSL x | bash"]),
      "bash -o pipefail -c 'curl -fsSL x | bash'",
    );
    assert.equal(formatArgv(["/x/grok", "update"]), "/x/grok update");
    assert.equal(formatArgv(["echo", "it's"]), `echo 'it'\\''s'`);
  });

  it("summarizes every exit shape", () => {
    assert.match(describeSetupExit({ ok: true, code: 0 }), /exit 0/);
    assert.match(describeSetupExit({ ok: false, code: 22 }), /exit 22/);
    assert.match(describeSetupExit({ ok: false, canceled: true }), /Canceled/);
    assert.match(describeSetupExit({ ok: false, timedOut: true }), /15 minutes/);
    assert.match(
      describeSetupExit({ ok: false, error: "already running" }),
      /already running/,
    );
  });
});
