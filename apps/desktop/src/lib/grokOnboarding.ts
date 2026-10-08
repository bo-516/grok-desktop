/**
 * Pure rules for grok CLI onboarding: which onboarding step the window shows,
 * which action the environment banner offers, and how setup-run output and
 * commands are rendered as text. No React, no store — the auth widget and the
 * shell banner both consume these.
 */

import type { EnvironmentInfo } from "@/bridge/liveBridgeTypes";
import type { GrokSetupExit } from "@/bridge/liveBridgeGrokSetupTypes";

/**
 * What the onboarding screen shows. CLI problems come first (the bridge checks
 * them first, and signing in needs a working CLI); `checking` covers the gap
 * between a signed-out login tick and the first CLI probe answer.
 */
export type OnboardingStep =
  | "checking"
  | "not_installed"
  | "bin_invalid"
  | "too_old"
  | "version_unreadable"
  | "probe_timeout"
  | "signed_out";

/** CLI failure kinds that become their own onboarding step. */
const CLI_STEPS: ReadonlySet<string> = new Set<OnboardingStep>([
  "not_installed",
  "bin_invalid",
  "too_old",
  "version_unreadable",
  "probe_timeout",
]);

/**
 * Steps the user may set aside with "Continue anyway": the CLI exists and may
 * still run sessions, so blocking the whole app would be worse than a banner.
 * Missing CLI, unusable custom path, and signed-out have no way past.
 */
const DEFERRABLE_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>([
  "too_old",
  "version_unreadable",
  "probe_timeout",
]);

/** Banner button kinds; the shell maps each to a handler. */
export type EnvBannerActionKind = "login" | "retry" | "setup";

/** Banner button: what it does and what it says. */
export type EnvBannerAction = { kind: EnvBannerActionKind; label: string };

/** Max characters of setup-run output kept on screen (the tail survives). */
export const RUN_LOG_MAX_CHARS = 64_000;

/**
 * Decide the onboarding step from the latest probes.
 * @param env Last `environment` snapshot; null before the first answer.
 * @param authed Login flag from the 3s poll / env probe; null when unknown.
 * @returns The step to show, or null when nothing needs onboarding (or
 *   nothing is known yet, which must not flash a screen on cold start).
 */
export function onboardingStep(
  env: EnvironmentInfo | null,
  authed: boolean | null,
): OnboardingStep | null {
  const kind = env?.failureKind ?? "";
  if (CLI_STEPS.has(kind)) {
    return kind as OnboardingStep;
  }
  if (authed === false) {
    return env ? "signed_out" : "checking";
  }
  return null;
}

/**
 * Whether the step offers "Continue anyway".
 * @param step Current step (null reads as not deferrable).
 * @returns True for too_old / version_unreadable / probe_timeout.
 */
export function isDeferrableStep(step: OnboardingStep | null): boolean {
  return step !== null && DEFERRABLE_STEPS.has(step);
}

/**
 * Pick the banner action for a failed environment probe, so the button always
 * matches the failure (no "Login" for a missing or outdated CLI).
 * @param env Last environment snapshot; null or ok yields null.
 * @returns The action, or null when there is nothing to offer.
 */
export function envBannerAction(
  env: EnvironmentInfo | null,
): EnvBannerAction | null {
  if (!env || env.ok) {
    return null;
  }
  switch (env.failureKind) {
    case "signed_out":
      return { kind: "login", label: "Sign in" };
    case "too_old":
      return { kind: "setup", label: "Update grok…" };
    case "not_installed":
    case "bin_invalid":
    case "version_unreadable":
      return { kind: "setup", label: "Set up grok…" };
    default:
      // probe_timeout, or a bridge that predates failureKind: probing again
      // is the only action that cannot be wrong.
      return { kind: "retry", label: "Retry" };
  }
}

/**
 * Remove ANSI color / cursor escapes so installer output reads as plain text.
 * @param text Raw output chunk.
 * @returns Text without CSI / OSC sequences.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Append one output chunk to the visible log: strips ANSI, turns CR line
 * endings into newlines, and keeps only the last `max` characters (cut at a
 * line start so the first visible line is whole).
 * @param prev Log so far.
 * @param chunk New raw output.
 * @param max Character cap; defaults to RUN_LOG_MAX_CHARS.
 * @returns The new log text.
 */
export function appendRunLog(
  prev: string,
  chunk: string,
  max: number = RUN_LOG_MAX_CHARS,
): string {
  const next = prev + stripAnsi(chunk).replace(/\r\n?/g, "\n");
  if (next.length <= max) {
    return next;
  }
  const tail = next.slice(next.length - max);
  const firstBreak = tail.indexOf("\n");
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
}

/**
 * Render argv as one readable command line (single-quotes arguments holding
 * spaces or shell metacharacters), for the "this will run" confirmation.
 * @param argv Exact argv from the bridge.
 * @returns Display string; "" for an empty argv.
 */
export function formatArgv(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      arg === "" || /[\s|&;<>()$`"'\\*?!#~]/.test(arg)
        ? `'${arg.replace(/'/g, `'\\''`)}'`
        : arg,
    )
    .join(" ");
}

/**
 * One-line outcome of a setup run for the status line under the log.
 * @param exit Exit payload from the bridge (or a local socket failure).
 * @returns Human summary, e.g. "Finished (exit 0)" or "Failed (exit 22)".
 */
export function describeSetupExit(exit: GrokSetupExit): string {
  if (exit.canceled) {
    return "Canceled.";
  }
  if (exit.timedOut) {
    return "Stopped: it ran longer than 15 minutes.";
  }
  if (exit.error) {
    return `Could not run: ${exit.error}`;
  }
  if (exit.ok) {
    return "Finished (exit 0). Checking grok again…";
  }
  const code = typeof exit.code === "number" ? exit.code : "unknown";
  return `Failed (exit ${code}). See the output above.`;
}
