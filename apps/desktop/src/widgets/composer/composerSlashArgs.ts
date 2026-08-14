/**
 * Desktop `/model` / `/effort` argument triggers and suggestion rows.
 * Extracted from composerCompletion so that file stays under the line cap.
 */

import { MENTION_SLASH_MARK } from "@/lib/mentionTokens";
import {
  advertisedEffortsForModel,
  isDesktopSlashArgCommand,
  matchSlashChoice,
  type SlashChoice,
  type SlashModelEffortRow,
} from "@/lib/slashBuiltins";
import type {
  CommandSuggestionContext,
  ComposerSuggestion,
  ComposerTrigger,
} from "./composerCompletion";

/**
 * Detect `/model …` / `/effort …` on the current line after the command name.
 * Replacement range is the full model query, or only the trailing effort token
 * once the leading `/model` argument already uniquely identifies a catalog row.
 * @param value Full textarea contents.
 * @param caret Clamped caret index.
 * @param catalogs Live model rows used to detect a completed model + effort slot.
 * @returns Argument trigger, or null when the line is not a desktop arg command.
 */
export function findDesktopSlashArgTrigger(
  value: string,
  caret: number,
  catalogs?: CommandSuggestionContext,
): ComposerTrigger | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const slashClass = `/${MENTION_SLASH_MARK}`;
  const match = new RegExp(
    `^([${slashClass}])([a-zA-Z][\\w-]*)(\\s+)([\\s\\S]*)$`,
  ).exec(line);
  if (!match) {
    return null;
  }
  const name = (match[2] ?? "").toLowerCase();
  if (!isDesktopSlashArgCommand(name)) {
    return null;
  }
  const mark = match[1] ?? "/";
  const nameAndSpace = (match[2] ?? "").length + (match[3] ?? "").length;
  const argStart = lineStart + mark.length + nameAndSpace;
  const args = match[4] ?? "";
  const target = resolveModelEffortSlot(
    name,
    args,
    catalogs?.models,
    catalogs?.availableModels,
  );
  const lastWs = Math.max(args.lastIndexOf(" "), args.lastIndexOf("\t"));
  const lastTokenStart = lastWs + 1;
  const start = target ? argStart + lastTokenStart : argStart;
  const query = target ? args.slice(lastTokenStart) : args;
  return {
    kind: "command",
    symbol: "/",
    query,
    start,
    end: caret,
    argCommand: target ? "effort" : name,
    argModelId: target?.modelId,
  };
}

/**
 * Whether `/model` arguments have moved on to the optional effort slot.
 * Requires a unique catalog model whose agent row advertised reasoningEfforts.
 * A model with no advertised efforts never opens the effort list (no demo ladder).
 * @param name Command name (`model` / `m` / `effort`).
 * @param args Text after the command name (may include a trailing space).
 * @param models Live model picker; missing/empty never promotes to effort.
 * @param availableModels Agent catalog; effort rows come only from this.
 * @returns Target model id when the effort slot is live; null otherwise.
 */
export function resolveModelEffortSlot(
  name: string,
  args: string,
  models: SlashChoice[] | undefined,
  availableModels: SlashModelEffortRow[] | undefined,
): { modelId: string } | null {
  if (name === "effort") {
    return null;
  }
  if (!models?.length) {
    return null;
  }
  const trailingSpace = /\s$/.test(args);
  const trimmed = args.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  let modelQuery = "";
  if (trailingSpace) {
    modelQuery = trimmed;
  } else if (parts.length > 1) {
    modelQuery = parts.slice(0, -1).join(" ");
  }
  if (!modelQuery) {
    return null;
  }
  const match = matchSlashChoice(modelQuery, models);
  if (match.status !== "exact" && match.status !== "unique") {
    return null;
  }
  const advertised = advertisedEffortsForModel(
    match.choice.id,
    availableModels,
  );
  if (advertised.length === 0) {
    return null;
  }
  return { modelId: match.choice.id };
}

/**
 * Map model / effort catalog rows into `/` argument suggestions.
 * The completion hook applies these on Enter / click — they do not stay in the draft.
 * @param kind `model` / `m` (ids as values) or `effort` (wire ids as values).
 * @param query Argument fragment; empty keeps catalog order.
 * @param choices Live picker rows; empty yields [].
 * @returns Rows whose id or label contains the query (case-insensitive).
 */
export function createArgChoiceSuggestions(
  kind: string,
  query: string,
  choices: SlashChoice[],
): ComposerSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return choices
    .filter((row) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        row.id.toLocaleLowerCase().includes(normalizedQuery) ||
        row.label.toLocaleLowerCase().includes(normalizedQuery)
      );
    })
    .map((row) => ({
      id: `${kind}:${row.id}`,
      kind: "command" as const,
      value: row.id,
      label: row.label,
      description: row.id !== row.label ? row.id : undefined,
    }));
}
