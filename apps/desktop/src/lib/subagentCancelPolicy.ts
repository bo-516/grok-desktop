/**
 * Subagent disposition when cancelling parent turn (F-SUB-07).
 */

export type SubagentCancelChoice = "ask" | "always_stop" | "always_continue";

/**
 * Resolve disposition from user choice / preference.
 * @param preference Stored preference; default ask.
 * @param interactiveChoice Optional one-shot choice from dialog.
 */
export function resolveSubagentCancel(
  preference: SubagentCancelChoice = "ask",
  interactiveChoice?: SubagentCancelChoice,
): SubagentCancelChoice {
  if (interactiveChoice) {
    return interactiveChoice;
  }
  return preference;
}

/**
 * Whether parent cancel should also stop subagents.
 */
export function shouldStopSubagents(choice: SubagentCancelChoice): boolean {
  return choice === "always_stop";
}
