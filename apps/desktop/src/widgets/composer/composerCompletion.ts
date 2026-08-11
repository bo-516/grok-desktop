/**
 * Pure completion rules for the Composer.
 * Does not read the DOM, store, or bridge, so `@` and `/skill` trigger/replace
 * behavior can be unit-tested in isolation.
 */

import type { AvailableCommand } from "@grok-desktop/acp-core";
import { mentionMarkForSymbol } from "@/lib/mentionTokens";

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
 * @param value Full textarea contents.
 * @param caret Caret position; out-of-range values are clamped so selection glitches cannot crash.
 * @returns A valid `@`/`/` token, or null when the user is typing ordinary text.
 */
export function findComposerTrigger(
  value: string,
  caret: number,
): ComposerTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
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

  const mark = mentionMarkForSymbol(trigger.symbol);
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
 * @param commands Command snapshot from the current SessionState; pass [] when there is no session.
 * @param query Name fragment after `/`; matching is case-insensitive.
 * @returns Up to 10 command/skill suggestions, keeping agent description and input hints.
 */
export function createCommandSuggestions(
  commands: AvailableCommand[],
  query: string,
): ComposerSuggestion[] {
  const normalizedQuery = query.toLocaleLowerCase();

  return commands
    .filter((command) => command.name.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 10)
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
 * Empty-list copy for the current completion state without inventing data sources.
 * @param kind Current trigger kind; returns "" when there is no trigger.
 * @param isLoadingEntries Whether a real bridge file listing is in flight.
 * @param canListEntries Whether the bridge is connectable and supports workspace reads.
 * @param hasWorkspaceLoadError Bridge request failed; when true the user must be told to recover the real bridge.
 * @returns Status copy suitable for the menu.
 */
export function getComposerEmptyLabel(
  kind: "mention" | "command" | undefined,
  isLoadingEntries: boolean,
  canListEntries: boolean,
  hasWorkspaceLoadError: boolean,
): string {
  if (kind === "mention") {
    if (isLoadingEntries) {return "Reading the current workspace…";}
    if (hasWorkspaceLoadError) {return "Could not read the workspace. Restart the bridge and try again.";}
    return canListEntries ? "No matching files" : "Connect the bridge to mention workspace files";
  }
  if (kind === "command") {return "Waiting for live grok-build to provide commands…";}
  return "";
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
