/**
 * Command palette search (F-CMD-06 / F-NATIVE-01) — pure ranking over sessions/commands/settings.
 */

export type PaletteItemKind = "session" | "command" | "setting" | "action";

export type PaletteItem = {
  id: string;
  kind: PaletteItemKind;
  label: string;
  description?: string;
  /** Slash command name without leading / when kind=command. */
  runValue?: string;
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
      id: "action:extensions",
      kind: "setting",
      label: "Open extensions / inspect",
      description: "MCP, skills, hooks, plugins",
      runValue: "open_extensions",
    },
    {
      id: "action:overview",
      kind: "setting",
      label: "Multi-session overview",
      description: "Fleet status across chats",
      runValue: "open_overview",
    },
    {
      id: "action:tasks",
      kind: "setting",
      label: "Background tasks",
      description: "Terminals, loops, /tasks",
      runValue: "open_tasks",
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
    new CustomEvent("grok-desktop:prefill-composer", { detail: text }),
  );
}

/**
 * Open a chrome drawer by id (settings / extensions / overview / tasks).
 * @param panel Panel id consumed by App open-panel listener.
 */
export function openAppPanel(
  panel: "settings" | "extensions" | "overview" | "tasks",
): void {
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-panel", { detail: panel }),
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
 * Map session catalog into palette items.
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
