/**
 * Command palette search (F-CMD-06 / F-NATIVE-01) — ranking over actions,
 * settings, slash commands, MCP servers, and skills. Sessions stay in the
 * sidebar search; they are not mounted in ⌘K.
 */

import { PREFILL_COMPOSER_EVENT } from "@/lib/composerFocus";

export type PaletteItemKind =
  | "action"
  | "setting"
  | "command"
  | "mcp"
  | "skill"
  | "session";

export type PaletteItem = {
  id: string;
  kind: PaletteItemKind;
  label: string;
  description?: string;
  /** Slash command / skill name without leading / , or a chrome run id. */
  runValue?: string;
  /**
   * When kind=skill, true means prefill `/{runValue}` in the composer.
   * False / omitted opens the Environment Skills page instead.
   */
  invokeAsSlash?: boolean;
};

/**
 * Filter and rank palette items by query (case-insensitive substring).
 * @param items Full catalog.
 * @param query User input; empty returns first limit items.
 * @param limit Max results.
 */
export function filterPaletteItems(
  items: PaletteItem[],
  query: string,
  limit = 20,
): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items.slice(0, limit);
  }
  const scored = items
    .map((item) => {
      const hay = `${item.label} ${item.description ?? ""} ${item.runValue ?? ""}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx < 0) {
        return null;
      }
      // Prefer prefix matches
      const score = idx === 0 ? 0 : idx;
      return { item, score };
    })
    .filter((x): x is { item: PaletteItem; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * Build default settings/actions entries for the palette.
 * Slash media/ops live here (and in composer `/`), not as permanent top-nav tabs —
 * matches Claude Desktop / Codex: command surface in palette + input, chrome stays views.
 */
export function defaultPaletteActions(): PaletteItem[] {
  return [
    {
      id: "action:new-chat",
      kind: "action",
      label: "New chat",
      description: "Start a new session",
      runValue: "new_chat",
    },
    {
      id: "action:settings",
      kind: "setting",
      label: "Open settings",
      description: "Sandbox, tools, appearance",
      runValue: "open_settings",
    },
    {
      id: "action:environment",
      kind: "setting",
      label: "Environment",
      description: "Agent environment — MCP, skills, plugins, hooks",
      runValue: "open_environment",
    },
    {
      id: "action:env-mcp",
      kind: "mcp",
      label: "MCP servers",
      description: "Open Environment on MCP servers",
      runValue: "open_env_mcp",
    },
    {
      id: "action:env-skills",
      kind: "skill",
      label: "Skills",
      description: "Open Environment on Skills",
      runValue: "open_env_skills",
    },
    {
      id: "action:env-plugins",
      kind: "setting",
      label: "Plugins",
      description: "Open Environment on Plugins",
      runValue: "open_env_plugins",
    },
    {
      id: "action:overview",
      kind: "setting",
      label: "Multi-session overview",
      description: "Fleet status across chats",
      runValue: "open_overview",
    },
    {
      id: "action:agents",
      kind: "setting",
      label: "Session agents",
      description: "Subagents and background tasks for this chat",
      runValue: "open_agents",
    },
    {
      id: "action:theme",
      kind: "action",
      label: "Toggle light / dark",
      description: "Appearance",
      runValue: "toggle_theme",
    },
    {
      id: "action:fork",
      kind: "command",
      label: "/fork",
      description: "Branch a new session from here",
      runValue: "fork",
    },
    {
      id: "action:rewind",
      kind: "action",
      label: "Rewind…",
      description: "Destructive disk rollback (confirm)",
      runValue: "open_rewind",
    },
    {
      id: "action:compact",
      kind: "command",
      label: "/compact",
      description: "Compress conversation context",
      runValue: "compact",
    },
    {
      id: "action:context",
      kind: "command",
      label: "/context",
      description: "Show context usage",
      runValue: "context",
    },
    {
      id: "action:usage",
      kind: "command",
      label: "/usage",
      description: "Show usage stats",
      runValue: "usage",
    },
    {
      id: "action:privacy",
      kind: "command",
      label: "/privacy",
      description: "Privacy controls",
      runValue: "privacy",
    },
    {
      id: "action:notes",
      kind: "command",
      label: "/release-notes",
      description: "Product release notes",
      runValue: "release-notes",
    },
    {
      id: "action:model",
      kind: "command",
      label: "/model …",
      description: "Switch model (optional effort)",
      runValue: "prefill_model",
    },
    {
      id: "action:effort",
      kind: "command",
      label: "/effort …",
      description: "Set reasoning effort",
      runValue: "prefill_effort",
    },
    {
      id: "action:imagine",
      kind: "action",
      label: "/imagine …",
      description: "Prefill composer for image gen",
      runValue: "prefill_imagine",
    },
    {
      id: "action:imagine-video",
      kind: "action",
      label: "/imagine-video …",
      description: "Prefill composer for video gen",
      runValue: "prefill_imagine_video",
    },
    {
      id: "action:login",
      kind: "setting",
      label: "Login (grok login)",
      description: "Browser OIDC",
      runValue: "auth_login",
    },
  ];
}

/**
 * Dispatch prefill into the composer (slash stubs that need user text).
 * @param text Draft text to place in the composer, e.g. "/imagine ".
 */
export function prefillComposer(text: string): void {
  window.dispatchEvent(
    new CustomEvent(PREFILL_COMPOSER_EVENT, { detail: text }),
  );
}

/**
 * Open a chrome drawer by id (settings / environment / overview).
 * @param panel Panel id consumed by App open-panel listener.
 */
export function openAppPanel(
  panel: "settings" | "environment" | "overview",
): void {
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-panel", { detail: panel }),
  );
}

/**
 * Open the Environment sheet, optionally on a specific page.
 * @param page Page id; defaults to overview when omitted.
 */
export function openEnvironment(
  page?:
    | "overview"
    | "mcp"
    | "skills"
    | "agents"
    | "plugins"
    | "marketplaces"
    | "hooks"
    | "rules"
    | "compat",
): void {
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-environment", {
      detail: page ?? "overview",
    }),
  );
}

/**
 * Open a session context rail surface (plan / agents / preview).
 * @param rail Rail id consumed by useShellChromeEvents open-rail listener.
 */
export function openAppRail(rail: "plan" | "agents" | "preview"): void {
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-rail", { detail: rail }),
  );
}

/**
 * Map agent availableCommands into palette items.
 * @param commands Agent command list.
 */
export function commandsToPaletteItems(
  commands: Array<{ name: string; description?: string }>,
): PaletteItem[] {
  return commands
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({
      id: `cmd:${c.name}`,
      kind: "command" as const,
      label: `/${c.name}`,
      description: c.description,
      runValue: c.name,
    }));
}

/**
 * Map merged MCP rows into palette items (kind=mcp).
 * @param servers Inspect ⊕ list rows; empty when the environment snapshot is cold.
 */
export function mcpToPaletteItems(
  servers: Array<{ name: string; target?: string; transport?: string }>,
): PaletteItem[] {
  return servers
    .filter((row) => row && typeof row.name === "string" && row.name.trim())
    .map((row) => ({
      id: `mcp:${row.name}`,
      kind: "mcp" as const,
      label: row.name,
      description: row.target?.trim() || row.transport || "MCP server",
      runValue: row.name,
    }));
}

/**
 * Map inspect skills into palette items (kind=skill).
 * @param skills Snapshot skills; invocable ones prefill `/{name}`.
 */
export function skillsToPaletteItems(
  skills: Array<{
    name: string;
    description?: string;
    userInvocable?: boolean;
  }>,
): PaletteItem[] {
  return skills
    .filter((row) => row && typeof row.name === "string" && row.name.trim())
    .map((row) => ({
      id: `skill:${row.name}`,
      kind: "skill" as const,
      label: `/${row.name}`,
      description: row.description,
      runValue: row.name,
      invokeAsSlash: row.userInvocable === true,
    }));
}

/**
 * Map session catalog into palette items.
 * Kept for unit tests and any future jump-to-session entry; ⌘K does not mount these.
 * @param sessions Catalog rows.
 */
export function sessionsToPaletteItems(
  sessions: Array<{ id: string; title?: string }>,
): PaletteItem[] {
  return sessions.map((s) => ({
    id: `session:${s.id}`,
    kind: "session" as const,
    label: s.title?.trim() || s.id.slice(0, 8),
    description: s.id,
    runValue: s.id,
  }));
}

/**
 * Visible name used to collapse "/imagine …" with a skill named imagine.
 * @param item Palette row.
 * @returns Lowercase label without a leading slash or trailing ellipsis.
 */
export function paletteItemName(item: PaletteItem): string {
  return item.label
    .replace(/^\/+/, "")
    .replace(/[.…]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * Deduplicate rows. MCP keeps its own namespace so a server and a skill
 * that share a name (e.g. browser-use) both stay visible; slash/action/skill
 * names collapse so `/imagine` is not listed twice.
 * @param groups Catalog slices in priority order (first group wins).
 * @returns Flattened unique items.
 */
export function mergePaletteItems(groups: PaletteItem[][]): PaletteItem[] {
  const seen = new Set<string>();
  const out: PaletteItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      const name = paletteItemName(item);
      const key = item.kind === "mcp" ? `mcp:${name}` : name;
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Build the live ⌘K catalog: curated actions, MCP servers, skills, then
 * leftover agent slash commands. Sessions are omitted on purpose.
 * @param input Agent command list plus environment snapshot slices.
 */
export function buildPaletteCatalog(input: {
  commands: Array<{ name: string; description?: string }>;
  mcpServers: Array<{ name: string; target?: string; transport?: string }>;
  skills: Array<{
    name: string;
    description?: string;
    userInvocable?: boolean;
  }>;
}): PaletteItem[] {
  return mergePaletteItems([
    defaultPaletteActions(),
    mcpToPaletteItems(input.mcpServers),
    skillsToPaletteItems(input.skills),
    commandsToPaletteItems(input.commands),
  ]);
}
