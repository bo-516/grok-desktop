/**
 * Parse `/model` / `/effort` drafts into local intents.
 * Effort tokens are validated against the target model's advertised catalog
 * when `effortsForModel` is supplied — never a session-wide demo ladder.
 */

import { materializeMentionTriggers } from "@/lib/mentionTokens";
import {
  isImmediateDesktopCommand,
  matchEffortExact,
  matchSlashChoice,
  parseSlashInvocation,
  splitModelAndEffort,
  type LocalSlashIntent,
  type ParseLocalSlashOptions,
  type SlashChoice,
} from "@/lib/slashBuiltins";

/**
 * Format a short "try these ids" hint for unknown / ambiguous arguments.
 * @param choices Rows to list; only the first four ids are shown.
 * @returns Comma-separated ids, or empty when the catalog is empty.
 */
function formatChoiceHint(choices: SlashChoice[]): string {
  return choices
    .slice(0, 4)
    .map((row) => row.id)
    .join(", ");
}

/**
 * Parse a composer draft into a desktop slash intent.
 * Only `/model`, `/m`, `/effort`, `/fork`, and `/rewind` are claimed;
 * everything else is `none` (sent to the agent).
 * @param text Raw composer draft (may contain zero-width slash marks).
 * @param models Live picker catalog; empty makes `/model name` an error.
 * @param efforts Session thinking ladder used only when `options.effortsForModel` is omitted.
 * @param options Per-model advertised efforts + current model for `/effort`.
 * @returns Intent for applyLocalSlashIntent; never throws.
 */
export function parseLocalSlash(
  text: string,
  models: SlashChoice[],
  efforts: SlashChoice[],
  options?: ParseLocalSlashOptions,
): LocalSlashIntent {
  const invocation = parseSlashInvocation(materializeMentionTriggers(text));
  if (!invocation) {
    return { kind: "none" };
  }
  const { name, args } = invocation;
  if (name === "model" || name === "m") {
    return parseModelIntent(args, models, efforts, options?.effortsForModel);
  }
  if (name === "effort") {
    const current = (options?.currentModel ?? "").trim();
    const advertised =
      options?.effortsForModel && current
        ? options.effortsForModel(current)
        : efforts;
    return parseEffortIntent(args, advertised);
  }
  if (isImmediateDesktopCommand(name) && !args) {
    return { kind: name === "rewind" ? "rewind" : "fork" };
  }
  return { kind: "none" };
}

/**
 * Resolve `/model` args into set / open-menu / error.
 * Effort is peeled only against the target model's advertised list.
 * @param args Text after `/model`; empty opens the visual picker.
 * @param models Live catalog.
 * @param fallbackEfforts Used only when `effortsForModel` is omitted (tests).
 * @param effortsForModel Agent catalog lookup; [] means this model has no effort arg.
 */
function parseModelIntent(
  args: string,
  models: SlashChoice[],
  fallbackEfforts: SlashChoice[],
  effortsForModel?: (modelId: string) => SlashChoice[],
): LocalSlashIntent {
  if (!args) {
    return { kind: "open_model_menu" };
  }
  const whole = matchSlashChoice(args, models);
  if (whole.status === "exact" || whole.status === "unique") {
    return {
      kind: "set_model",
      modelId: whole.choice.id,
      modelLabel: whole.choice.label,
    };
  }
  const splitTarget = splitModelTargetAndRest(args, models);
  if (!splitTarget) {
    return unknownModelIntent(args, models);
  }
  const advertised = effortsForModel
    ? effortsForModel(splitTarget.model.id)
    : fallbackEfforts;
  if (advertised.length === 0) {
    return {
      kind: "error",
      message: `${splitTarget.model.label} does not advertise reasoning-effort levels`,
    };
  }
  const peeled = splitModelAndEffort(
    `${splitTarget.model.id} ${splitTarget.rest}`,
    advertised,
  );
  if (!peeled.effort) {
    return {
      kind: "error",
      message: unknownEffortMessage(splitTarget.rest, advertised),
    };
  }
  return {
    kind: "set_model",
    modelId: splitTarget.model.id,
    modelLabel: splitTarget.model.label,
    effortId: peeled.effort.id,
    effortLabel: peeled.effort.label,
  };
}

/**
 * Split `/model` args into a leading catalog model and the remaining tokens.
 * Tries the longest leading prefix first so multi-word labels still match.
 * @param args Raw `/model` arguments.
 * @param models Live picker catalog.
 * @returns Target model + rest, or null when no leading prefix matches uniquely.
 */
function splitModelTargetAndRest(
  args: string,
  models: SlashChoice[],
): { model: SlashChoice; rest: string } | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  for (let end = parts.length - 1; end >= 1; end -= 1) {
    const lead = parts.slice(0, end).join(" ");
    const match = matchSlashChoice(lead, models);
    if (match.status === "exact" || match.status === "unique") {
      return {
        model: match.choice,
        rest: parts.slice(end).join(" "),
      };
    }
  }
  return null;
}

/**
 * Unknown / ambiguous / empty-catalog error for a `/model` query.
 * @param modelQuery User fragment that did not resolve to one catalog row.
 * @param models Live picker catalog.
 */
function unknownModelIntent(
  modelQuery: string,
  models: SlashChoice[],
): LocalSlashIntent {
  const match = matchSlashChoice(modelQuery, models);
  if (match.status === "ambiguous") {
    const hint = formatChoiceHint(match.matches);
    return {
      kind: "error",
      message: hint
        ? `Ambiguous model “${modelQuery}”. Try: ${hint}`
        : `Ambiguous model “${modelQuery}”`,
    };
  }
  if (models.length === 0) {
    return {
      kind: "error",
      message: "No models available from the agent yet",
    };
  }
  const hint = formatChoiceHint(models);
  return {
    kind: "error",
    message: hint
      ? `Unknown model “${modelQuery}”. Try: ${hint}`
      : `Unknown model “${modelQuery}”`,
  };
}

/**
 * Error copy when a trailing token is not in the target model's advertised list.
 * @param query User effort fragment.
 * @param efforts Advertised rows for that model.
 */
function unknownEffortMessage(query: string, efforts: SlashChoice[]): string {
  const hint = formatChoiceHint(efforts);
  if (efforts.length === 0) {
    return "No reasoning-effort levels available for this model";
  }
  return hint
    ? `Unknown effort “${query}”. Try: ${hint}`
    : `Unknown effort “${query}”`;
}

/**
 * Resolve `/effort` args into set / open-menu / error.
 * @param args Text after `/effort`; empty opens the visual picker.
 * @param efforts Advertised (or test) thinking ladder for the current model.
 */
function parseEffortIntent(
  args: string,
  efforts: SlashChoice[],
): LocalSlashIntent {
  if (!args) {
    return { kind: "open_effort_menu" };
  }
  const exact = matchEffortExact(args, efforts);
  if (exact) {
    return {
      kind: "set_effort",
      effortId: exact.id,
      effortLabel: exact.label,
    };
  }
  const match = matchSlashChoice(args, efforts);
  if (match.status === "exact" || match.status === "unique") {
    return {
      kind: "set_effort",
      effortId: match.choice.id,
      effortLabel: match.choice.label,
    };
  }
  if (match.status === "ambiguous") {
    const hint = formatChoiceHint(match.matches);
    return {
      kind: "error",
      message: hint
        ? `Ambiguous effort “${args}”. Try: ${hint}`
        : `Ambiguous effort “${args}”`,
    };
  }
  return {
    kind: "error",
    message: unknownEffortMessage(args, efforts),
  };
}
