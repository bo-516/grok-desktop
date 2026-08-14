/**
 * Thinking / reasoning-effort options for the composer control menu.
 * Same contract as grok-build: a model only accepts levels its menu
 * advertises (`config_option_update`, then that model's `reasoningEfforts`).
 * No family regex fallback and no Extra High injection.
 */

import type { AvailableModel } from "@grok-desktop/acp-core";

/**
 * Reasoning effort id (wire value for `--reasoning-effort` / agent config).
 * Prefer values from grok-build `config_option_update` or the model catalog.
 */
export type ThinkingEffort = string;

/** One row in the thinking intensity submenu. */
export type ThinkingOption = {
  /** Wire id (e.g. `low`, `medium`, `high`, `xhigh`). */
  id: ThinkingEffort;
  /** Human label for the menu and chrome pill. */
  label: string;
  /** True when this row is the model/agent default. */
  default?: boolean;
};

/**
 * grok-build models_cache snapshot for grok-4.5 (`low/medium/high`).
 * Label / test fixture only — not a client fallback when the agent is silent.
 */
export const DEFAULT_THINKING_OPTIONS: ThinkingOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/**
 * grok-build models_cache snapshot for grok-4.6 (`xhigh` default).
 * Label / test fixture only — do not inject these rows onto another model.
 */
export const GROK_46_THINKING_OPTIONS: ThinkingOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High", default: true },
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
 * `xhigh` is Extra High (Grok 4.6 catalog); `max` stays Max and is not invented
 * as a menu row. Empty falls back to High.
 * @param effortId Wire id; empty falls back to High.
 */
export function formatEffortIdLabel(effortId: string): string {
  const id = effortId.trim().toLowerCase();
  if (!id) {
    return "High";
  }
  if (id === "xhigh") {
    return "Extra High";
  }
  if (id === "max") {
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
 * Compact a catalog label for the composer chip (drop a trailing "Effort").
 * @param id Wire id used when the raw label is empty.
 * @param raw Optional agent/catalog label.
 */
function compactEffortLabel(id: string, raw?: string): string {
  if (id === "xhigh") {
    return "Extra High";
  }
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return formatEffortIdLabel(id);
  }
  return trimmed.replace(/\s+effort\s*$/i, "").trim() || formatEffortIdLabel(id);
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
 * Map a catalog model's reasoningEfforts into menu rows.
 * Empty or unmatched `modelId` is [] — never inherit `availableModels[0]`.
 * @param modelId Live session model to match by id or name; empty yields [].
 * @param availableModels Handshake / session catalog (may carry reasoningEfforts).
 * @returns Menu rows in catalog order, or [] when no matching model advertised them.
 */
export function thinkingFromAvailableModels(
  modelId: string | undefined,
  availableModels: AvailableModel[] | undefined,
): ThinkingOption[] {
  const id = (modelId ?? "").trim();
  if (!id || !Array.isArray(availableModels) || availableModels.length === 0) {
    return [];
  }
  const match = availableModels.find((m) => m.id === id || m.name === id);
  const rows = match?.reasoningEfforts;
  if (!rows?.length) {
    return [];
  }
  const mapped: ThinkingOption[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const wire = row.id.trim();
    if (!wire || seen.has(wire)) {
      continue;
    }
    seen.add(wire);
    const option: ThinkingOption = {
      id: wire,
      label: compactEffortLabel(wire, row.label),
    };
    if (row.default) {
      option.default = true;
    }
    mapped.push(option);
  }
  return mapped;
}

/**
 * Resolve the thinking submenu from grok-build advertisements only.
 * Order: live `config_option_update` → matching model `reasoningEfforts` →
 * [] (agent has not advertised a menu for this model).
 * @param configOptions Agent config_option_update snapshot.
 * @param modelId Live session model id or name; empty / unmatched yields [].
 * @param availableModels Session catalog; used when it carries reasoningEfforts.
 * @returns Advertised rows in agent/catalog order, or [].
 */
export function resolveThinkingOptions(
  configOptions: unknown[] | undefined,
  modelId?: string,
  availableModels?: AvailableModel[],
): ThinkingOption[] {
  const fromAgent = thinkingFromConfigOptions(configOptions);
  if (fromAgent.length > 0) {
    return fromAgent;
  }
  return thinkingFromAvailableModels(modelId, availableModels);
}

/**
 * Default wire id for a resolved option list.
 * Prefers a row marked `default`, then Extra High when listed, then High.
 * Empty list yields "" — do not invent a family default.
 * @param options Active thinking menu rows from grok-build.
 */
export function defaultEffortFromOptions(
  options: ThinkingOption[],
): ThinkingEffort {
  if (options.length === 0) {
    return "";
  }
  const marked = options.find((o) => o.default);
  if (marked) {
    return marked.id;
  }
  if (options.some((o) => o.id === "xhigh")) {
    return "xhigh";
  }
  if (options.some((o) => o.id === DEFAULT_THINKING_EFFORT)) {
    return DEFAULT_THINKING_EFFORT;
  }
  return options[options.length - 1]?.id ?? "";
}

/**
 * Pick the effective effort for first paint / after agent options change.
 * Advertised menu: valid local pref → agent currentValue → list default.
 * Empty menu (handshake not in yet): keep pref or agent current, do not invent.
 * Prefs the current advertised list does not include (e.g. `xhigh` on 4.5) drop.
 * @param configOptions Agent config snapshot (for currentValue).
 * @param options Active thinking menu rows (empty = not advertised yet).
 * @param preferred Optional localStorage (or prior UI) preference.
 * @param _modelId Unused; kept so existing call sites type-check.
 */
export function resolveThinkingEffort(
  configOptions: unknown[] | undefined,
  options: ThinkingOption[],
  preferred?: string | null,
  _modelId?: string,
): ThinkingEffort {
  const valid = new Set(options.map((o) => o.id));
  const pref = typeof preferred === "string" ? preferred.trim() : "";
  const agentCurrent = currentEffortFromConfig(configOptions);
  if (options.length === 0) {
    return pref || agentCurrent || "";
  }
  if (pref && valid.has(pref)) {
    return pref;
  }
  if (agentCurrent && valid.has(agentCurrent)) {
    return agentCurrent;
  }
  return defaultEffortFromOptions(options);
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
 * Load persisted thinking effort, clamped to the advertised option list.
 * Empty `options` keeps the raw stored id (handshake not in yet).
 * @param options Advertised rows; default [] does not invent a family ladder.
 * @param modelId Unused; kept so existing call sites type-check.
 * @returns Stored id when valid or menu unknown; else the advertised default.
 */
export function loadThinkingEffort(
  options: ThinkingOption[] = [],
  modelId?: string,
): ThinkingEffort {
  return resolveThinkingEffort(
    undefined,
    options,
    loadThinkingEffortRaw(),
    modelId,
  );
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
