/**
 * Onboarding commands block: each offered command with Copy and Run, the
 * "this will run" confirmation, live output, and the outcome line.
 * Stateless — {@link useGrokSetupRunWidget} owns every flag and handler.
 */

import cs from "classnames";
import type { GrokSetupCommand } from "@/bridge/liveBridgeGrokSetupTypes";
import { describeSetupExit, formatArgv } from "@/lib/grokOnboarding";
import type { GrokSetupRunWidgetState } from "./useGrokSetupRunWidget";

/** Caption per action above its command row. */
const ACTION_LABELS: Record<GrokSetupCommand["action"], string> = {
  install: "Install (official installer)",
  update: "Update",
};

export type OnboardingSetupViewProps = GrokSetupRunWidgetState & {
  /** Commands to offer, in display order (from EnvironmentInfo.setup). */
  commands: GrokSetupCommand[];
  /** Run button label for the first (primary) command. */
  primaryRunLabel: string;
};

/**
 * Render commands, confirmation, and output.
 * @param props Run state plus the commands to offer.
 * @returns The block; Run buttons are disabled while a run is in progress.
 */
export function OnboardingSetupView(props: OnboardingSetupViewProps) {
  const { commands, confirming, started, running, log, exit, copied } = props;
  const failed = exit !== null && !exit.ok;
  return (
    <>
      {commands.map((command, index) => (
        <div key={command.action} className="w-full flex flex-col gap-1.5">
          <p className="onboarding-label">{ACTION_LABELS[command.action]}</p>
          <div className="onboarding-command">
            <code className="onboarding-command-text">{command.display}</code>
            <span className="onboarding-row-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => props.onCopy(command)}
              >
                {copied === command.display ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className={cs("btn", { "btn-primary": index === 0 })}
                disabled={running || confirming !== null}
                onClick={() => props.onRequestRun(command)}
              >
                {index === 0 ? props.primaryRunLabel : "Run"}
              </button>
            </span>
          </div>
        </div>
      ))}

      {confirming ? (
        <div className="onboarding-confirm" role="group" aria-label="Confirm">
          <span>Grok Desktop will run this on your computer:</span>
          <pre className="onboarding-argv">{formatArgv(confirming.argv)}</pre>
          <span className="onboarding-row-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={props.onConfirmRun}
            >
              Run now
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={props.onCancelConfirm}
            >
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      {started && (running || exit) ? (
        <>
          <p className="onboarding-label">
            {running ? "Running" : "Ran"}: {formatArgv(started.argv)}
          </p>
          <pre className="onboarding-log" aria-live="polite">
            {log || (running ? "Waiting for output…" : "(no output)")}
          </pre>
        </>
      ) : null}

      {running ? (
        <button type="button" className="btn-ghost" onClick={props.onCancelRun}>
          Stop
        </button>
      ) : null}
      {exit ? (
        <p
          className={cs("onboarding-status", {
            "onboarding-status-error": failed,
          })}
          role="status"
        >
          {describeSetupExit(exit)}
        </p>
      ) : null}
    </>
  );
}
