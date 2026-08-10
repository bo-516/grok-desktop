/**
 * Model list helpers for the composer control menu.
 * Model catalog comes from the agent (availableModels / configOptions).
 * Thinking effort lives in `composerThinking.ts` and is re-exported here for a
 * single composer-models import path used by the bar controls and tests.
 */

import type { AvailableModel } from "@grok-desktop/acp-core";
import {
  resolveThinkingEffort,
  resolveThinkingOptions,
  type ThinkingEffort,
} from "./composerThinking";

export type {
  ThinkingEffort,
  ThinkingOption,
} from "./composerThinking";
export {
  currentEffortFromConfig,
  DEFAULT_THINKING_EFFORT,
  DEFAULT_THINKING_OPTIONS,
  formatEffortIdLabel,
  formatThinkingLabel,
  loadThinkingEffort,
  loadThinkingEffortRaw,
  resolveThinkingEffort,
  resolveThinkingOptions,
  saveThinkingEffort,
  thinkingFromConfigOptions,
  THINKING_OPTIONS,
} from "./composerThinking";

/** One selectable model entry for the picker. */
export type ComposerModelOption = {
  id: string;
  label: string;
};

const MODEL_STORAGE_KEY = "grok-desktop.preferred-model.v1";

/**
 * Human label for a model id when the agent did not supply a display name.
 * @param modelId Raw model id from session or picker.
 */
export function formatModelLabel(modelId: string): string {
  if (!modelId) {
    return "Grok";
  }
  const cleaned = modelId.replace(/^grok[-_]?/i, "Grok ").replace(/[-_]/g, " ");
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^heavy$/i.test(part)) {
        return "Heavy";
      }
      if (/^\d/.test(part)) {
        return part;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Map agent AvailableModel rows into composer picker options.
 * @param availableModels Session catalog from handshake / session models; empty yields [].
 */
export function modelsFromAvailableModels(
  availableModels: AvailableModel[] | undefined,
): ComposerModelOption[] {
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    return [];
  }
  const out: ComposerModelOption[] = [];
  const seen = new Set<string>();
  for (const row of availableModels) {
    if (!row || typeof row.id !== "string") {
      continue;
    }
    const id = row.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : formatModelLabel(id);
    out.push({ id, label });
  }
  return out;
}

/**
 * Pull model options out of agent config_option_update snapshots.
 * Supports loose shapes: `{ id: "model", options: [...] }` or model objects with modelId/name.
 * @param configOptions Session configOptions array; non-arrays yield [].
 */
export function modelsFromConfigOptions(
  configOptions: unknown[] | undefined,
): ComposerModelOption[] {
  if (!Array.isArray(configOptions) || configOptions.length === 0) {
    return [];
  }
  for (const raw of configOptions) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const opt = raw as Record<string, unknown>;
    const id = String(opt.id ?? opt.name ?? opt.type ?? "");
    if (!/model/i.test(id) && opt.type !== "model") {
      continue;
    }
    const options = opt.options ?? opt.choices ?? opt.values;
    if (!Array.isArray(options)) {
      continue;
    }
    const mapped: ComposerModelOption[] = [];
    for (const item of options) {
      if (typeof item === "string") {
        mapped.push({ id: item, label: formatModelLabel(item) });
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const mid = String(
        rec.value ?? rec.id ?? rec.modelId ?? rec.name ?? "",
      );
      if (!mid) {
        continue;
      }
      const label = String(rec.name ?? rec.label ?? formatModelLabel(mid));
      mapped.push({ id: mid, label });
    }
    if (mapped.length > 0) {
      return mapped;
    }
  }
  return [];
}

/**
 * Read current model value from config options when present.
 * @param configOptions Agent snapshot.
 */
export function currentModelFromConfig(
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
    if (!/model/i.test(id) && opt.type !== "model") {
      continue;
    }
    const cur = opt.currentValue ?? opt.value ?? opt.selected;
    if (typeof cur === "string" && cur) {
      return cur;
    }
  }
  return null;
}

/**
 * Resolve the list shown in the model submenu from agent data only.
 * Prefer live config_option_update model options; else handshake availableModels.
 * When the live session model is missing from the catalog, prepend it so chrome stays consistent.
 * Never invent a product fallback catalog when the agent has not declared models.
 * @param configOptions Agent config_option_update snapshot.
 * @param availableModels Session catalog from initialize / session/new|load.
 * @param sessionModel Current session.model string.
 */
export function resolveModelOptions(
  configOptions: unknown[] | undefined,
  availableModels: AvailableModel[] | undefined,
  sessionModel: string,
): ComposerModelOption[] {
  const fromConfig = modelsFromConfigOptions(configOptions);
  const fromAgent = modelsFromAvailableModels(availableModels);
  const base = fromConfig.length > 0 ? fromConfig : fromAgent;

  if (
    sessionModel &&
    !base.some((m) => m.id === sessionModel || m.label === sessionModel)
  ) {
    return [
      { id: sessionModel, label: formatModelLabel(sessionModel) },
      ...base,
    ];
  }
  return base;
}

/**
 * Default model + thinking for "Reset to defaults".
 * Model comes from the agent (config current, else first catalog entry, else session model).
 * Effort prefers agent currentValue when present and valid; else official default `high`.
 * @param agentDefaultModel Agent-preferred id; empty string leaves model unset for the caller to skip.
 * @param configOptions Optional agent config snapshot for effort currentValue / allowed list.
 */
export function defaultComposerControls(
  agentDefaultModel = "",
  configOptions?: unknown[],
): {
  modelId: string;
  effort: ThinkingEffort;
} {
  const options = resolveThinkingOptions(configOptions);
  return {
    modelId: agentDefaultModel.trim(),
    effort: resolveThinkingEffort(configOptions, options, null),
  };
}

/**
 * Pick the agent default model id for reset / first paint.
 * Order: config currentValue → first catalog entry → live session model.
 * @param configOptions Agent config snapshot.
 * @param models Resolved picker options.
 * @param sessionModel Current session.model.
 */
export function resolveAgentDefaultModel(
  configOptions: unknown[] | undefined,
  models: ComposerModelOption[],
  sessionModel: string,
): string {
  return (
    currentModelFromConfig(configOptions) ||
    models[0]?.id ||
    sessionModel.trim() ||
    ""
  );
}

/**
 * Load last preferred model override (local preference; live setModel still calls ACP).
 */
export function loadPreferredModel(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist preferred model id locally.
 * @param modelId Selected model id.
 */
export function savePreferredModel(modelId: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {
    /* ignore */
  }
}
