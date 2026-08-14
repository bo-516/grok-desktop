/**
 * Pure completion rules for the Composer.
 * Does not read the DOM, store, or bridge, so `@` and `/skill` trigger/replace
 * behavior can be unit-tested in isolation.
 */

import type { AvailableCommand } from "@grok-desktop/acp-core";
import { mentionMarkForSymbol } from "@/lib/mentionTokens";
import {
  advertisedEffortsForModel,
  isDesktopSlashArgCommand,
  type SlashChoice,
  type SlashModelEffortRow,
} from "@/lib/slashBuiltins";
import {
  createArgChoiceSuggestions,
  findDesktopSlashArgTrigger,
} from "./composerSlashArgs";

/** Minimal workspace entry shape required by Composer-side bridge file listing. */
export type ComposerWorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
  /** true when git check-ignore reports ignored; undefined when unknown. */
  ignored?: boolean;
};

/** The `@` file or `/` command token under the current caret. */
export type ComposerTrigger = {
  kind: "mention" | "command";
  symbol: "@" | "/";
  query: string;
  start: number;
  end: number;
  /**
   * Desktop command whose arguments are being completed (`model` / `m` / `effort`).
   * Missing on a still-typed `/name` token (no space yet) so the command list shows.
   */
  argCommand?: string;
  /**
   * Target model id when completing `/model <id> [effort]`.
   * Effort suggestions must come from this model's advertised catalog.
   */
  argModelId?: string;
};

/**
 * Optional catalogs so `/model` / `/effort` can complete their arguments.
 * Omitted fields leave argument completion empty (command list still works).
 */
export type CommandSuggestionContext = {
  /** Command name when the caret is in that command's argument slot. */
  argCommand?: string;
  /** Live model picker rows. */
  models?: SlashChoice[];
  /**
   * Handshake / session availableModels. Effort args read each row's
   * `reasoningEfforts` only — never a session-wide or family fallback list.
   */
  availableModels?: SlashModelEffortRow[];
  /** Live session model id for bare `/effort`. */
  currentModel?: string;
  /** Target model id when already in a `/model <id>` effort slot. */
  argModelId?: string;
};

/** Unified completion candidate for the view; `value` omits the trigger symbol. */
export type ComposerSuggestion = {
  id: string;
  kind: "file" | "directory" | "command" | "skill";
  value: string;
  label: string;
  description?: string;
  inputHint?: string;
  /**
   * true when bridge marked the path gitignored; only then show the secondary badge.
   * undefined/false → no badge (unknown must never hide the entry).
   */
  ignored?: boolean;
};

/**
 * Finds a completion trigger in the token before the caret.
 * Desktop `/model` / `/effort` lines keep the menu open after the command name
 * so arguments (model id, effort level) can be picked the same way.
 * @param value Full textarea contents.
 * @param caret Caret position; out-of-range values are clamped so selection glitches cannot crash.
 * @param catalogs Live model / effort rows; needed to detect the `/model` effort slot.
 * @returns A valid `@`/`/` token, or null when the user is typing ordinary text.
 */
export function findComposerTrigger(
  value: string,
  caret: number,
  catalogs?: CommandSuggestionContext,
): ComposerTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const argTrigger = findDesktopSlashArgTrigger(value, safeCaret, catalogs);
  if (argTrigger) {
    return argTrigger;
  }
  const prefix = value.slice(0, safeCaret);
  const lastWhitespace = Math.max(
    prefix.lastIndexOf(" "),
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("\t"),
    prefix.lastIndexOf("\r"),
  );
  const start = lastWhitespace + 1;
  const token = prefix.slice(start);
  const symbol = token[0];
  const mentionStart = prefix.lastIndexOf("@");
  const mentionPrefix = mentionStart > 0 ? prefix[mentionStart - 1] ?? "" : "";
  const mentionQuery = mentionStart >= 0 ? prefix.slice(mentionStart + 1) : "";
  const isEmailLike = /[a-z0-9._%+-]/i.test(mentionPrefix);

  if (symbol === "/") {
    return {
      kind: "command",
      symbol,
      query: token.slice(1),
      start,
      end: safeCaret,
    };
  }
  if (mentionStart < 0 || isEmailLike || /\s/.test(mentionQuery)) {return null;}

  return {
    kind: "mention",
    symbol: "@",
    query: mentionQuery,
    start: mentionStart,
    end: safeCaret,
  };
}

/**
 * Replaces the active trigger token with the chosen candidate and places the caret after the insert.
 * Stores a zero-width mark instead of visible `@`/`/` so the mirror can hide the trigger without
 * leaving an advance-width gap; `materializeMentionTriggers` restores agent syntax on send.
 * @param value Original input.
 * @param trigger Current valid trigger; bad ranges are clamped rather than thrown.
 * @param suggestionValue Candidate value without `@` or `/`; empty values leave the text unchanged.
 * @returns New text and the caret position to write back to the textarea selection.
 */
export function replaceComposerTrigger(
  value: string,
  trigger: ComposerTrigger,
  suggestionValue: string,
): { value: string; caret: number } {
  const replacement = suggestionValue.trim();
  const start = Math.max(0, Math.min(trigger.start, value.length));
  const end = Math.max(start, Math.min(trigger.end, value.length));
  /** grok-build `@` syntax needs quotes to preserve spaces in file names. */
  const escapedReplacement =
    trigger.symbol === "@" && /\s/.test(replacement)
      ? `"${replacement.replaceAll('"', '\\"')}"`
      : replacement;
  /** Existing whitespace is kept from the original so mid-token completion does not double spaces. */
  const suffix = value.slice(end);
  const needsTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix);

  if (!replacement) {return { value, caret: end };}

  /**
   * Argument picks (`/model grok-4.6`) must not insert another slash mark —
   * the command token already carries the trigger.
   */
  const mark = trigger.argCommand ? "" : mentionMarkForSymbol(trigger.symbol);
  const inserted = `${mark}${escapedReplacement}${
    needsTrailingSpace ? " " : ""
  }`;
  return {
    value: `${value.slice(0, start)}${inserted}${suffix}`,
    caret: start + inserted.length,
  };
}

/**
 * Rewrite an absolute (or `file://`) mention query to a workspace-relative
 * fragment when it lives under `workspace`. Relative queries pass through.
 * Bridge entries are always relative paths, so a pasted absolute path must be
 * remapped here too — the client re-filters the bridge payload with the same
 * query the user typed.
 * @param query Raw text after `@` (relative fragment, absolute path, or file URI).
 * @param workspace Absolute workspace root; empty disables absolute remapping.
 * @returns Lowercased relative fragment for matching; empty when the query is
 *   empty or names the workspace root; original lowercased absolute text when
 *   the path sits outside the workspace (matches nothing on purpose).
 */
export function normalizeMentionQuery(
  query: string,
  workspace: string = "",
): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }
  let candidate = trimmed;
  if (candidate.startsWith("file://")) {
    try {
      candidate = decodeURIComponent(candidate.slice("file://".length) || "/");
    } catch {
      candidate = candidate.slice("file://".length) || "/";
    }
  }
  // POSIX absolute, or Windows drive path (composer may receive either).
  const isAbsolute =
    candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate);
  if (!isAbsolute || !workspace.trim()) {
    return trimmed.toLocaleLowerCase();
  }
  const toPosix = (p: string) => p.replace(/\\/g, "/");
  const trimSlash = (p: string) => {
    const t = p.replace(/\/+$/, "");
    return t || "/";
  };
  const qPosix = trimSlash(toPosix(candidate));
  const wsPosix = trimSlash(toPosix(workspace.trim()));
  const qLower = qPosix.toLocaleLowerCase();
  const wsLower = wsPosix.toLocaleLowerCase();
  if (qLower === wsLower) {
    return "";
  }
  if (qLower.startsWith(`${wsLower}/`)) {
    return qPosix.slice(wsPosix.length + 1).toLocaleLowerCase();
  }
  return trimmed.toLocaleLowerCase();
}

/**
 * Filters real bridge workspace entries by the user query.
 * @param entries Bridge-sorted candidates; this function never touches the filesystem.
 * @param query Query after `@` (relative or absolute under the workspace); matching is case-insensitive.
 * @param workspace Absolute workspace root used to remap absolute queries; omit when unknown.
 * @returns Up to 10 file/directory suggestions suitable for the menu.
 */
export function createMentionSuggestions(
  entries: ComposerWorkspaceEntry[],
  query: string,
  workspace: string = "",
): ComposerSuggestion[] {
  const normalizedQuery = normalizeMentionQuery(query, workspace);

  return entries
    .filter((entry) => {
      const pathLower = entry.path.toLocaleLowerCase();
      // Empty query after remap (typed workspace root) keeps the bridge order.
      if (!normalizedQuery) {
        return true;
      }
      return pathLower.includes(normalizedQuery);
    })
    .slice(0, 10)
    .map((entry) => ({
      id: `${entry.kind}:${entry.path}`,
      kind: entry.kind,
      value: entry.path,
      label: entry.path,
      // Kind is shown only on the kind badge to avoid File/file double labels.
      // Pass through only known true so unknown never paints a badge.
      ignored: entry.ignored === true ? true : undefined,
    }));
}

/**
 * Converts agent-advertised commands into `/` menu items and marks skill metadata.
 * When `context.argCommand` is set, the menu lists model or effort arguments
 * instead of command names so `/model` / `/effort` can be completed in place.
 * @param commands Command snapshot from the current SessionState; pass [] when there is no session.
 * @param query Name fragment after `/`, or the active argument token.
 * @param context Optional desktop argument catalogs; omitted keeps command-only matching.
 * @returns Matching command/skill suggestions in agent order, keeping description and input hints.
 *   File `@` mentions stay capped; slash catalogs are longer (skills + builtins) and the
 *   menu already scrolls (`max-h-80`), so a 10-row cut would hide most of the live list.
 */
export function createCommandSuggestions(
  commands: AvailableCommand[],
  query: string,
  context?: CommandSuggestionContext,
): ComposerSuggestion[] {
  const argCommand = context?.argCommand;
  if (argCommand && isDesktopSlashArgCommand(argCommand)) {
    if (argCommand === "effort") {
      const targetId = context?.argModelId || context?.currentModel || "";
      const advertised = advertisedEffortsForModel(
        targetId,
        context?.availableModels,
      );
      return createArgChoiceSuggestions("effort", query, advertised);
    }
    return createArgChoiceSuggestions(
      argCommand,
      query,
      context?.models ?? [],
    );
  }
  const normalizedQuery = query.toLocaleLowerCase();

  return commands
    .filter((command) => command.name.toLocaleLowerCase().includes(normalizedQuery))
    .map((command) => ({
      id: `command:${command.name}`,
      kind: isSkillCommand(command) ? "skill" : "command",
      value: command.name,
      label: `/${command.name}`,
      description: command.description,
      inputHint: command.input?.hint,
    }));
}

/**
 * Extra `/` empty-state context so New chat does not claim we are waiting
 * on grok-build when the catalog is already resolved (or simply unmatched).
 */
export type ComposerCommandEmptyState = {
  /** Resolved catalog size (live + cache + inspect), not the filtered menu. */
  catalogSize: number;
  /** Session store connection mode; disconnected / connecting change the copy. */
  connectionMode: string;
  /** True while inspect / connect is still the only way to fill an empty catalog. */
  isLoadingCatalog: boolean;
};

/**
 * Empty-list copy for the current completion state without inventing data sources.
 * @param kind Current trigger kind; returns "" when there is no trigger.
 * @param isLoadingEntries Whether a real bridge file listing is in flight.
 * @param canListEntries Whether the bridge is connectable and supports workspace reads.
 * @param hasWorkspaceLoadError Bridge request failed; when true the user must be told to recover the real bridge.
 * @param commandState Optional `/` catalog connection state; omitted treats the list as unmatched.
 * @returns Status copy suitable for the menu.
 */
export function getComposerEmptyLabel(
  kind: "mention" | "command" | undefined,
  isLoadingEntries: boolean,
  canListEntries: boolean,
  hasWorkspaceLoadError: boolean,
  commandState?: ComposerCommandEmptyState,
): string {
  if (kind === "mention") {
    if (isLoadingEntries) {return "Reading the current workspace…";}
    if (hasWorkspaceLoadError) {return "Could not read the workspace. Restart the bridge and try again.";}
    return canListEntries ? "No matching files" : "Connect the bridge to mention workspace files";
  }
  if (kind !== "command") {
    return "";
  }
  if ((commandState?.catalogSize ?? 0) > 0) {
    return "No matching commands";
  }
  if (
    commandState?.isLoadingCatalog ||
    commandState?.connectionMode === "connecting"
  ) {
    return "Loading commands…";
  }
  if (commandState?.connectionMode === "disconnected") {
    return "Connect the bridge to load commands";
  }
  return "No matching commands";
}

/**
 * Whether a command comes from an agent-registered skill.
 * @param command Command already normalized via ACP metadata.
 * @returns true when scope/path markers are present; unknown metadata is treated as a plain command.
 */
function isSkillCommand(command: AvailableCommand): boolean {
  const scope = command._meta?.scope;
  const skillPath = command._meta?.path;

  return typeof scope === "string" || typeof skillPath === "string";
}
