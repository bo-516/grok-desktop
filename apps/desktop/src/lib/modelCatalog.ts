/**
 * Window-scoped grok-build model catalog.
 * New chat is a local draft and does not run session/new, so the composer
 * reads this cache when the painted session has no catalog. A live session
 * with its own models wins. New chat and workspace switch must not clear it —
 * only non-empty remember() fields replace what is stored.
 */

import {
  normalizeAvailableModels,
  type AvailableModel,
} from "@grok-desktop/acp-core";

/** localStorage key for the last non-empty model catalog. */
export const MODEL_CATALOG_STORAGE_KEY = "grok-desktop.model-catalog.v1";

/** Cached model id, picker rows, and config selects. */
export type ModelCatalogSnapshot = {
  /** Agent current model id. Empty when unknown. */
  model: string;
  /** Picker catalog, including reasoningEfforts and reasoningEffort. */
  availableModels: AvailableModel[];
  /** Live configOptions when a session reported them. Empty when absent. */
  configOptions: unknown[];
};

/**
 * Empty snapshot used when storage is missing or corrupt.
 * @returns Model "", no rows, no config. Callers must not invent a catalog.
 */
export function emptyModelCatalog(): ModelCatalogSnapshot {
  return { model: "", availableModels: [], configOptions: [] };
}

/**
 * Coerce an untrusted JSON value into a snapshot.
 * @param value Parsed storage or a partial inbound bag. Non-objects yield empty.
 * @returns Normalized snapshot. Invalid model rows are dropped, not repaired
 *          into a hardcoded list.
 */
export function normalizeModelCatalog(value: unknown): ModelCatalogSnapshot {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const availableModels = normalizeAvailableModels(record.availableModels);
  const configOptions = Array.isArray(record.configOptions)
    ? record.configOptions
    : [];
  return { model, availableModels, configOptions };
}

/**
 * Read the persisted catalog.
 * Corrupt JSON or a missing store yields an empty snapshot.
 * @returns Normalized snapshot; empty when nothing usable is stored.
 */
export function loadModelCatalog(): ModelCatalogSnapshot {
  if (typeof localStorage === "undefined") {
    return emptyModelCatalog();
  }
  try {
    const raw = localStorage.getItem(MODEL_CATALOG_STORAGE_KEY);
    if (!raw) {
      return emptyModelCatalog();
    }
    return normalizeModelCatalog(JSON.parse(raw) as unknown);
  } catch {
    return emptyModelCatalog();
  }
}

/**
 * Persist a snapshot. Empty snapshots are still written when the caller asks;
 * remember() is what refuses to replace a good cache with empty fields.
 * @param snapshot Catalog to store.
 * @returns False when storage is missing or the write throws.
 */
export function saveModelCatalog(snapshot: ModelCatalogSnapshot): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    localStorage.setItem(MODEL_CATALOG_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fold incoming fields into the previous snapshot.
 * Empty model, empty models, and empty config are ignored so a draft hydrate
 * cannot wipe a catalog the window already learned. Non-empty models replace
 * the list (a session catalog is authoritative, not a union).
 * @param prev Stored snapshot.
 * @param incoming Partial live session or initialize probe. Missing fields skip.
 * @returns Next snapshot. Identical inputs can still return a new object;
 *          compare with modelCatalogEqual before writing storage.
 */
export function mergeModelCatalog(
  prev: ModelCatalogSnapshot,
  incoming: Partial<ModelCatalogSnapshot>,
): ModelCatalogSnapshot {
  const next: ModelCatalogSnapshot = {
    model: prev.model,
    availableModels: prev.availableModels,
    configOptions: prev.configOptions,
  };
  const model = typeof incoming.model === "string" ? incoming.model.trim() : "";
  if (model) {
    next.model = model;
  }
  const models = normalizeAvailableModels(incoming.availableModels);
  if (models.length > 0) {
    next.availableModels = models;
  }
  if (Array.isArray(incoming.configOptions) && incoming.configOptions.length > 0) {
    next.configOptions = incoming.configOptions;
  }
  return next;
}

/**
 * Field equality for the three stored values.
 * @param a Left snapshot.
 * @param b Right snapshot.
 * @returns True when model, rows, and config JSON match.
 */
export function modelCatalogEqual(
  a: ModelCatalogSnapshot,
  b: ModelCatalogSnapshot,
): boolean {
  return (
    a.model === b.model &&
    JSON.stringify(a.availableModels) === JSON.stringify(b.availableModels) &&
    JSON.stringify(a.configOptions) === JSON.stringify(b.configOptions)
  );
}

/**
 * Composer sources. A painted session with its own model list wins.
 * When that session has models but no configOptions yet, cached config is
 * not used — a stale reasoning_effort currentValue would hide the session
 * row's reasoningEffort. The cache fills the empty draft (no session models).
 * An empty session model id still falls back to the cached id so the chip
 * is not the blank "Grok" placeholder.
 * @param args Session fields and the window cache. Undefined lists are empty.
 * @returns Model id, rows, and config the menu should read. Empty rows mean
 *          the agent has not advertised a catalog yet.
 */
export function resolveComposerModelSources(args: {
  sessionModel: string;
  sessionModels: AvailableModel[] | undefined;
  sessionConfig: unknown[] | undefined;
  cachedModel: string;
  cachedModels: AvailableModel[] | undefined;
  cachedConfig: unknown[] | undefined;
}): {
  model: string;
  availableModels: AvailableModel[];
  configOptions: unknown[];
} {
  const sessionModels = args.sessionModels ?? [];
  const sessionConfig = args.sessionConfig ?? [];
  const sessionHasModels = sessionModels.length > 0;
  const availableModels = sessionHasModels
    ? sessionModels
    : (args.cachedModels ?? []);
  const model = args.sessionModel.trim() || args.cachedModel.trim();
  // Non-empty session config wins. A session that already has models must not
  // inherit a stale cached reasoning_effort. Only the empty draft uses cache.
  let configOptions: unknown[];
  if (sessionConfig.length > 0) {
    configOptions = sessionConfig;
  } else if (sessionHasModels) {
    configOptions = [];
  } else {
    configOptions = args.cachedConfig ?? [];
  }
  return { model, availableModels, configOptions };
}
