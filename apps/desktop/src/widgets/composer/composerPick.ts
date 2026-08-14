/**
 * Decide whether a completion pick inserts text or applies a desktop slash.
 * `/model` / `/effort` argument rows switch chrome immediately — they must
 * not land in the composer as a draft the user then has to send.
 */

import {
  isDesktopSlashArgCommand,
  isImmediateDesktopCommand,
} from "@/lib/slashBuiltins";
import {
  findComposerTrigger,
  replaceComposerTrigger,
  type CommandSuggestionContext,
  type ComposerTrigger,
} from "./composerCompletion";

/**
 * Planned effect of accepting one completion row.
 * `apply.draft` is the `/model …` / `/effort …` line parseLocalSlash should see;
 * `value` / `caret` are the insert fallback when apply is unwired or returns none.
 */
export type SuggestionPickPlan =
  | { kind: "none" }
  | {
      kind: "apply";
      draft: string;
      value: string;
      caret: number;
    }
  | { kind: "insert"; value: string; caret: number };

/**
 * Whether this trigger is a `/model` / `/m` / `/effort` argument slot.
 * Command-name tokens (`/mod`) stay on the insert path so the arg list can open.
 * @param trigger Current completion trigger; missing argCommand is not an arg slot.
 */
export function isLocalSlashArgTrigger(trigger: ComposerTrigger): boolean {
  return Boolean(
    trigger.argCommand && isDesktopSlashArgCommand(trigger.argCommand),
  );
}

/**
 * Whether picking this command *name* should run desktop chrome immediately.
 * Only bare session ops (`/fork`, `/rewind`); `/model` still inserts so args can be picked.
 * @param trigger Current completion trigger; argument slots are handled separately.
 * @param suggestionValue Candidate command name without `/`.
 */
export function isImmediateDesktopCommandPick(
  trigger: ComposerTrigger,
  suggestionValue: string,
): boolean {
  if (trigger.kind !== "command" || trigger.argCommand) {
    return false;
  }
  return isImmediateDesktopCommand(suggestionValue);
}

/**
 * Plan the effect of accepting `suggestionValue` at the current caret.
 * @param draft Full textarea contents.
 * @param caret Caret index used to locate the trigger.
 * @param suggestionValue Candidate `value` (no leading `@` / `/`).
 * @param catalogs Live model/effort rows so `/model <id>` effort slots resolve.
 * @returns `apply` for desktop arg picks, `insert` for `@` / `/skill` / command names, `none` with no trigger.
 */
export function planSuggestionPick(
  draft: string,
  caret: number,
  suggestionValue: string,
  catalogs?: CommandSuggestionContext,
): SuggestionPickPlan {
  const trigger = findComposerTrigger(draft, caret, catalogs);
  if (!trigger) {
    return { kind: "none" };
  }
  const replacement = replaceComposerTrigger(draft, trigger, suggestionValue);
  if (
    isLocalSlashArgTrigger(trigger) ||
    isImmediateDesktopCommandPick(trigger, suggestionValue)
  ) {
    return {
      kind: "apply",
      draft: replacement.value,
      value: replacement.value,
      caret: replacement.caret,
    };
  }
  return {
    kind: "insert",
    value: replacement.value,
    caret: replacement.caret,
  };
}
