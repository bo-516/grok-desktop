/**
 * Stateful onboarding commands block: {@link useGrokSetupRunWidget} wired to
 * {@link OnboardingSetupView}. Mounted only on steps that offer commands, so
 * the streaming log never re-renders the rest of the gate.
 */

import type { GrokSetupCommand } from "@/bridge/liveBridgeGrokSetupTypes";
import { OnboardingSetupView } from "./OnboardingSetupView";
import { useGrokSetupRunWidget } from "./useGrokSetupRunWidget";

export type OnboardingSetupWidgetProps = {
  /** Commands to offer; the first is the primary action. */
  commands: GrokSetupCommand[];
  /** Label on the primary Run button ("Run installer", "Update"). */
  primaryRunLabel: string;
};

/**
 * Commands block with its own run state.
 * @param props Commands and the primary button label.
 * @returns The block, or null when there is nothing to offer (old bridge).
 */
export function OnboardingSetupWidget(props: OnboardingSetupWidgetProps) {
  const state = useGrokSetupRunWidget();
  if (props.commands.length === 0) {
    return null;
  }
  return (
    <OnboardingSetupView
      {...state}
      commands={props.commands}
      primaryRunLabel={props.primaryRunLabel}
    />
  );
}
