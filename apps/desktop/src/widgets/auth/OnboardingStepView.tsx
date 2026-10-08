/**
 * Body of the onboarding screen for one step: title, explanation, and the
 * step's actions (install / update commands, custom path, sign in, check
 * again, continue anyway). Stateless — the gate hook decides the step and
 * owns every handler; command runs and the path form are their own widgets.
 */

import type { EnvironmentInfo } from "@/bridge/liveBridgeTypes";
import type { GrokSetupCommand } from "@/bridge/liveBridgeGrokSetupTypes";
import type { OnboardingStep } from "@/lib/grokOnboarding";
import { GrokBinSettingWidget } from "@/widgets/grokCli";
import { OnboardingSetupWidget } from "./OnboardingSetupWidget";

export type OnboardingStepViewProps = {
  /** Step to render. */
  step: OnboardingStep;
  /** Latest probe; supplies the message, commands, and versions. */
  env: EnvironmentInfo | null;
  /** id for the step title (the dialog's aria-labelledby). */
  titleId: string;
  /** id for the step explanation (the dialog's aria-describedby). */
  descId: string;
  /** True while `grok login` runs. */
  busy: boolean;
  /** Run `grok login`. */
  onLogin: () => void;
  /** True while a requested re-probe has not answered yet. */
  rechecking: boolean;
  /** Re-run check_environment. */
  onRecheck: () => void;
  /** Whether "Continue anyway" is offered. */
  deferrable: boolean;
  /** Set this step aside and show the app (banner stays). */
  onDefer: () => void;
};

/** Fixed title per step. */
const TITLES: Record<OnboardingStep, string> = {
  checking: "Checking for grok…",
  signed_out: "Sign in to Grok",
  not_installed: "Install the grok CLI",
  bin_invalid: "Can't use the configured grok",
  too_old: "Update the grok CLI",
  version_unreadable: "grok didn't report its version",
  probe_timeout: "grok is not responding",
};

/**
 * Explanation under the title; the bridge message carries the specifics.
 * @param step Current step.
 * @param env Latest probe (message / path).
 * @returns One paragraph of copy.
 */
function stepCopy(step: OnboardingStep, env: EnvironmentInfo | null): string {
  const message = env?.message ?? "";
  switch (step) {
    case "checking":
      return "Looking for the grok CLI on this computer.";
    case "signed_out":
      return "Grok Desktop runs the local grok CLI, and that CLI has no credential yet. Signing in opens your browser; this window unlocks on its own once it succeeds.";
    case "not_installed":
      return "Grok Desktop runs the grok CLI from xAI, and it isn't installed where the app can find it. Paste the command into a terminal, or let the app run it for you.";
    case "probe_timeout":
      return `${message} A freshly installed or updated CLI can stall on its first launch while the system checks it; trying again usually works.`;
    default:
      return message;
  }
}

/**
 * Commands offered on a step, primary first.
 * @param step Current step.
 * @param env Latest probe; missing `setup` (old bridge) offers nothing.
 * @returns Commands for the setup widget.
 */
function stepCommands(
  step: OnboardingStep,
  env: EnvironmentInfo | null,
): GrokSetupCommand[] {
  const setup = env?.setup;
  if (!setup) {
    return [];
  }
  if (step === "too_old") {
    return setup.update ? [setup.update, setup.install] : [setup.install];
  }
  if (step === "not_installed" || step === "version_unreadable") {
    return [setup.install];
  }
  return [];
}

/** Steps that show the custom grok path form. */
const PATH_FORM_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>([
  "not_installed",
  "bin_invalid",
  "version_unreadable",
]);

/**
 * Render one onboarding step.
 * @param props Step, probe, and handlers from the gate hook.
 * @returns Title, copy, and the step's controls.
 */
export function OnboardingStepView(props: OnboardingStepViewProps) {
  const { step, env } = props;
  const commands = stepCommands(step, env);
  const cliStep = step !== "signed_out" && step !== "checking";
  return (
    <>
      <h1 id={props.titleId} className="login-gate-title">
        {TITLES[step]}
      </h1>
      <p id={props.descId} className="login-gate-copy">
        {stepCopy(step, env)}
      </p>

      {step === "signed_out" ? (
        <>
          <button
            type="button"
            className="btn btn-primary login-gate-primary"
            disabled={props.busy}
            onClick={props.onLogin}
          >
            {props.busy ? "Waiting for browser…" : "Open login page"}
          </button>
          {/* One line, no path: the full auth.json location wrapped to four
              lines here and buried the action. It lives in Settings. */}
          <p className="login-gate-hint">
            Or set XAI_API_KEY before launching the app.
          </p>
        </>
      ) : null}

      <OnboardingSetupWidget
        commands={commands}
        primaryRunLabel={step === "too_old" ? "Update" : "Run installer"}
      />

      {PATH_FORM_STEPS.has(step) ? (
        <GrokBinSettingWidget
          label={
            step === "bin_invalid"
              ? "Fix or clear the custom grok path"
              : "Already installed somewhere else? Path to grok"
          }
        />
      ) : null}

      {cliStep ? (
        <div className="onboarding-actions">
          <button
            type="button"
            className="btn"
            disabled={props.rechecking}
            onClick={props.onRecheck}
          >
            {props.rechecking ? "Checking…" : "Check again"}
          </button>
          {props.deferrable ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={props.onDefer}
            >
              Continue anyway
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
