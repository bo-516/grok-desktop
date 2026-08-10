/**
 * Thinking / reasoning-effort options for the composer control menu.
 * Prefer grok-build `config_option_update` when present; product fallback is
 * the official Grok 4.5 ladder only (`low` / `medium` / `high`) — never invent Max.
 */

/**
 * Reasoning effort id (wire value for `--reasoning-effort` / agent config).
 * Prefer values from grok-build `config_option_update`; product fallback is
 * the official Grok 4.5 set only (`low` / `medium` / `high`).
 */
export type ThinkingEffort = string;

/** One row in the thinking intensity submenu. */
export type ThinkingOption = {
  /** Wire id (e.g. `low`, `medium`, `high`). */
  id: ThinkingEffort;
  /** Human label for the menu and chrome pill. */
  label: string;
};

/**
 * Official Grok 4.5 effort ladder used when the agent has not advertised options.
 * Do not add `xhigh` / `max` here — those only appear if grok-build lists them.
 */
export const DEFAULT_THINKING_OPTIONS: ThinkingOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/**
 * @deprecated Prefer `DEFAULT_THINKING_OPTIONS` or `resolveThinkingOptions`.
 * Alias kept so existing imports keep working during the agent-driven migration.
 */
export const THINKING_OPTIONS = DEFAULT_THINKING_OPTIONS;

/** Default effort when neither localStorage nor agent currentValue is available. */
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "high";

const THINKING_STORAGE_KEY = "grok-desktop.thinking-effort.v1";

/**
 * True when a config option row describes reasoning / thinking effort.
 * Matches common ACP / grok-build ids (`effort`, `reasoning_effort`, `thinking`).
 * @param id Option id / name / type string from the agent snapshot.
 */
function isEffortConfigId(id: string): boolean {
  return /effort|reasoning|thinking/i.test(id) && !/model/i.test(id);
}

/**
 * Friendly label for a raw effort wire id when the agent omitted a display name.
 * Maps known aliases (`xhigh`/`max` → Max) but does not invent menu rows.
 * @param effortId Wire id; empty falls back to High.
 */
export function formatEffortIdLabel(effortId: string): string {
  const id = effortId.trim().toLowerCase();
  if (!id) {
    return "High";
  }
  if (id === "xhigh" || id === "max") {
    return "Max";
  }
  if (id === "minimal") {
    return "Minimal";
  }
  if (id === "none") {
    return "None";
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Label for a thinking effort id against a known option list.
 * @param effort Selected intensity wire id.
 * @param options Active menu rows (agent-resolved or default); unknown ids use `formatEffortIdLabel`.
 */
export function formatThinkingLabel(
  effort: string,
  options: ThinkingOption[] = DEFAULT_THINKING_OPTIONS,
): string {
  const hit = options.find((o) => o.id === effort);
  return hit?.label ?? formatEffortIdLabel(effort);
}

/**
 * Pull reasoning-effort choices out of agent `config_option_update` snapshots.
 * Supports loose shapes: `{ id: "effort"|"reasoning_effort", options: [...] }`.
 * @param configOptions Session configOptions array; non-arrays yield [].
 * @returns Mapped menu rows in agent order; empty when the agent did not advertise effort.
 */
export function thinkingFromConfigOptions(
  configOptions: unknown[] | undefined,
): ThinkingOption[] {
  if (!Array.isArray(configOptions) || configOptions.length === 0) {
    return [];
  }
  for (const raw of configOptions) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const opt = raw as Record<string, unknown>;
    const id = String(opt.id ?? opt.name ?? opt.type ?? "");
    if (!isEffortConfigId(id) && opt.type !== "effort") {
      continue;
    }
    const options = opt.options ?? opt.choices ?? opt.values;
    if (!Array.isArray(options)) {
      continue;
    }
    const mapped: ThinkingOption[] = [];
    const seen = new Set<string>();
    for (const item of options) {
      if (typeof item === "string") {
        const wire = item.trim();
        if (!wire || seen.has(wire)) {
          continue;
        }
        seen.add(wire);
        mapped.push({ id: wire, label: formatEffortIdLabel(wire) });
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const wire = String(rec.value ?? rec.id ?? rec.name ?? "").trim();
      if (!wire || seen.has(wire)) {
        continue;
      }
      seen.add(wire);
      const labelRaw = rec.name ?? rec.label;
      const label =
        typeof labelRaw === "string" && labelRaw.trim()
          ? labelRaw.trim()
          : formatEffortIdLabel(wire);
      mapped.push({ id: wire, label });
    }
    if (mapped.length > 0) {
      return mapped;
    }
  }
  return [];
}

/**
 * Read current effort value from config options when present.
 * @param configOptions Agent snapshot.
 * @returns Wire id or null when the agent did not report a current effort.
 */
export function currentEffortFromConfig(
  configOptions: unknown[] | undefined,
): string | null {
  if (!Array.isArray(configOptions)) {
    return null;
  }
  for (const raw of configOptions) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const opt = raw as Record<string, unknown>;
    const id = String(opt.id ?? opt.name ?? opt.type ?? "");
    if (!isEffortConfigId(id) && opt.type !== "effort") {
      continue;
    }
    const cur = opt.currentValue ?? opt.value ?? opt.selected;
    if (typeof cur === "string" && cur.trim()) {
      return cur.trim();
    }
  }
  return null;
}

/**
 * Resolve the thinking submenu from agent data when available.
 * Prefer live `config_option_update` effort options; else the official Grok 4.5 ladder.
 * @param configOptions Agent config_option_update snapshot.
 */
export function resolveThinkingOptions(
  configOptions: unknown[] | undefined,
): ThinkingOption[] {
  const fromAgent = thinkingFromConfigOptions(configOptions);
  return fromAgent.length > 0 ? fromAgent : DEFAULT_THINKING_OPTIONS;
}

/**
 * Pick the effective effort for first paint / after agent options change.
 * Order: valid local preference → agent currentValue → default `high` if listed → last option.
 * Legacy prefs such as `xhigh` that the current model does not advertise are discarded.
 * @param configOptions Agent config snapshot (for currentValue).
 * @param options Active thinking menu rows.
 * @param preferred Optional localStorage (or prior UI) preference.
 */
export function resolveThinkingEffort(
  configOptions: unknown[] | undefined,
  options: ThinkingOption[],
  preferred?: string | null,
): ThinkingEffort {
  const valid = new Set(options.map((o) => o.id));
  const pref = typeof preferred === "string" ? preferred.trim() : "";
  if (pref && valid.has(pref)) {
    return pref;
  }
  const agentCurrent = currentEffortFromConfig(configOptions);
  if (agentCurrent && valid.has(agentCurrent)) {
    return agentCurrent;
  }
  if (valid.has(DEFAULT_THINKING_EFFORT)) {
    return DEFAULT_THINKING_EFFORT;
  }
  return options[options.length - 1]?.id ?? DEFAULT_THINKING_EFFORT;
}

/**
 * Read raw thinking preference from localStorage (may be a stale / unsupported id).
 * @returns Stored wire id or null when missing / unreadable.
 */
export function loadThinkingEffortRaw(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(THINKING_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Load persisted thinking effort, clamped to the active option list.
 * Use when agent options are not yet known — falls back to official defaults only.
 * @param options Allowed rows; defaults to the official Grok 4.5 ladder (no Max).
 * @returns Valid effort or `high` / last option.
 */
export function loadThinkingEffort(
  options: ThinkingOption[] = DEFAULT_THINKING_OPTIONS,
): ThinkingEffort {
  return resolveThinkingEffort(undefined, options, loadThinkingEffortRaw());
}

/**
 * Persist thinking effort for the next session.
 * @param effort Selected intensity id (must be a value the UI offered).
 */
export function saveThinkingEffort(effort: ThinkingEffort): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(THINKING_STORAGE_KEY, effort);
  } catch {
    /* ignore */
  }
}
