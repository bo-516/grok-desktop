/**
 * Desktop-handled grok-build pager commands (`/model`, `/effort`) plus
 * session ops (`/fork`, `/rewind`) that the ⋯ menu and ⌘K already run locally.
 * The ACP handshake only advertises skills + a few shell builtins; model and
 * reasoning effort are pager-side (the TUI intercepts them). Visual chrome
 * already writes the same state — these commands must apply it too.
 */

import type { AvailableCommand } from "@grok-desktop/acp-core";

/** One selectable model or effort row for matching and `/` argument completion. */
export type SlashChoice = {
  /** Wire id sent to setModel / saveThinkingEffort. */
  id: string;
  /** Human label shown in the menu and success notice. */
  label: string;
};

/**
 * Agent model catalog row needed to look up advertised reasoning efforts.
 * Matches AvailableModel's effort fields without importing composer widgets.
 */
export type SlashModelEffortRow = {
  id: string;
  name?: string;
  reasoningEfforts?: Array<{ id: string; label?: string; default?: boolean }>;
};

/**
 * Optional parse context so `/model <target>` peels effort from that
 * model's advertised catalog — never the current session's thinking menu.
 */
export type ParseLocalSlashOptions = {
  /**
   * Advertised efforts for a model id. Return [] when the agent omitted them.
   * When set, `/model` and `/effort` ignore the session-wide `efforts` list.
   */
  effortsForModel?: (modelId: string) => SlashChoice[];
  /** Live session model id; used only by bare `/effort`. */
  currentModel?: string;
};

/**
 * Outcome of parsing a composer draft as a desktop slash command.
 * `none` means send the draft to the agent; every other kind is handled here.
 */
export type LocalSlashIntent =
  | { kind: "none" }
  | { kind: "open_model_menu" }
  | { kind: "open_effort_menu" }
  | {
      kind: "set_model";
      modelId: string;
      modelLabel: string;
      effortId?: string;
      effortLabel?: string;
    }
  | { kind: "set_effort"; effortId: string; effortLabel: string }
  | { kind: "fork" }
  | { kind: "rewind" }
  | { kind: "error"; message: string };

/**
 * Desktop session ops that run on pick / submit and never stay in the composer.
 * `/fork` and `/rewind` match the session ⋯ menu and ⌘K; they are not agent prompts.
 * @param name Command name without `/`; unknown names are not immediate.
 */
export function isImmediateDesktopCommand(name: string): boolean {
  const id = name.trim().toLowerCase();
  return id === "fork" || id === "rewind";
}

/**
 * Desktop `/` rows that grok-build does not advertise over ACP.
 * `/m` is accepted on submit but omitted here so the menu is not doubled.
 */
export const DESKTOP_SLASH_COMMANDS: AvailableCommand[] = [
  {
    name: "model",
    description: "Switch model (optional effort as a second argument)",
    input: { hint: "<name> [effort]" },
  },
  {
    name: "effort",
    description: "Set reasoning effort on the current model",
    input: { hint: "<low|medium|high|xhigh>" },
  },
];

/**
 * Catalog slice for {@link resolveSlashCatalog}.
 * @returns A new array so callers can concatenate without mutating the constant.
 */
export function desktopSlashCommands(): AvailableCommand[] {
  return DESKTOP_SLASH_COMMANDS.map((command) => ({ ...command }));
}

/**
 * Label for an advertised effort row. Uses the agent label when present;
 * otherwise a short form of the wire id. Does not invent missing rows.
 * @param id Wire id from the catalog.
 * @param raw Optional agent/catalog label.
 */
function advertisedEffortLabel(id: string, raw?: string): string {
  const trimmed = raw?.trim() ?? "";
  if (trimmed) {
    return trimmed.replace(/\s+effort\s*$/i, "").trim() || id;
  }
  if (id === "xhigh") {
    return "Extra High";
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Reasoning-effort rows the agent advertised on this exact catalog model.
 * Does not fall back to another model, family ladders, or Extra High injection.
 * @param modelId Target model id or display name; empty yields [].
 * @param catalog Handshake / session availableModels (or a compatible slice).
 * @returns Catalog order; [] when this model has no reasoningEfforts.
 */
export function advertisedEffortsForModel(
  modelId: string | undefined,
  catalog: SlashModelEffortRow[] | undefined,
): SlashChoice[] {
  const id = (modelId ?? "").trim();
  if (!id || !Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }
  const match = catalog.find((row) => row.id === id || row.name === id);
  const rows = match?.reasoningEfforts;
  if (!rows?.length) {
    return [];
  }
  const out: SlashChoice[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const wire = row.id.trim();
    if (!wire || seen.has(wire)) {
      continue;
    }
    seen.add(wire);
    out.push({ id: wire, label: advertisedEffortLabel(wire, row.label) });
  }
  return out;
}

/**
 * Whether a slash name takes desktop argument completion (`/model`, `/m`, `/effort`).
 * Unknown names stay on the regular command list (skills / agent builtins).
 * @param name Command name without `/`; empty is not an arg command.
 */
export function isDesktopSlashArgCommand(name: string): boolean {
  const id = name.trim().toLowerCase();
  return id === "model" || id === "m" || id === "effort";
}

/**
 * Parse a materialized draft as a single leading slash invocation.
 * The whole trimmed string must be `/name` or `/name args` — mixed prose is ignored.
 * @param text Composer draft after {@link materializeMentionTriggers}; marks are not accepted.
 * @returns Lowercased name plus trimmed args, or null when this is not a lone slash line.
 */
export function parseSlashInvocation(
  text: string,
): { name: string; args: string } | null {
  const trimmed = text.trim();
  const match = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    name: (match[1] ?? "").toLowerCase(),
    args: (match[2] ?? "").trim(),
  };
}

/**
 * Collapse an effort token for exact compare (spaces / hyphens dropped).
 * @param value Raw id, label, or user token.
 * @returns Lowercased compact form; empty when value is blank.
 */
function compactEffortToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Exact effort match (id, label, or Extra High aliases). Substring is not used
 * so `/model grok-4.6 high` does not steal a model whose name contains "high".
 * @param token Last argument word or two-word label (`extra high`).
 * @param efforts Active thinking ladder; empty yields null.
 * @returns The matching row, or null when nothing is exact.
 */
export function matchEffortExact(
  token: string,
  efforts: SlashChoice[],
): SlashChoice | null {
  const compact = compactEffortToken(token);
  if (!compact) {
    return null;
  }
  for (const effort of efforts) {
    const id = compactEffortToken(effort.id);
    const label = compactEffortToken(effort.label);
    if (compact === id || compact === label) {
      return effort;
    }
    if (
      id === "xhigh" &&
      (compact === "xh" || compact === "xhigh" || compact === "extrahigh")
    ) {
      return effort;
    }
  }
  return null;
}

/**
 * Peel a trailing effort token off `/model` args when a model query remains.
 * Bare `/model high` is left as a model query so a model named High still matches.
 * @param args Raw `/model` arguments (already trimmed).
 * @param efforts Active thinking ladder.
 * @returns Remaining model query and optional peeled effort.
 */
export function splitModelAndEffort(
  args: string,
  efforts: SlashChoice[],
): { modelQuery: string; effort?: SlashChoice } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { modelQuery: "" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { modelQuery: trimmed };
  }
  if (parts.length >= 2) {
    const two = `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
    const byTwo = matchEffortExact(two, efforts);
    if (byTwo) {
      return { modelQuery: parts.slice(0, -2).join(" "), effort: byTwo };
    }
  }
  const last = parts[parts.length - 1] ?? "";
  const byOne = matchEffortExact(last, efforts);
  if (byOne) {
    return { modelQuery: parts.slice(0, -1).join(" "), effort: byOne };
  }
  return { modelQuery: trimmed };
}

/**
 * Match a user token against catalog choices (models or efforts).
 * Order: case-insensitive exact id/label → unique substring of id or label.
 * @param query User fragment; empty is `none` (caller handles bare `/model`).
 * @param choices Catalog rows; empty is `none`.
 * @returns Exact/unique hit, ambiguous list, or none.
 */
export function matchSlashChoice(
  query: string,
  choices: SlashChoice[],
):
  | { status: "exact" | "unique"; choice: SlashChoice }
  | { status: "ambiguous"; matches: SlashChoice[] }
  | { status: "none" } {
  const q = query.trim().toLowerCase();
  if (!q || choices.length === 0) {
    return { status: "none" };
  }
  const exact = choices.find(
    (row) => row.id.toLowerCase() === q || row.label.toLowerCase() === q,
  );
  if (exact) {
    return { status: "exact", choice: exact };
  }
  const matches = choices.filter((row) => {
    return (
      row.id.toLowerCase().includes(q) || row.label.toLowerCase().includes(q)
    );
  });
  if (matches.length === 1 && matches[0]) {
    return { status: "unique", choice: matches[0] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "none" };
}
