/**
 * Fault-tolerant normalization for ACP initialize and command metadata.
 * grok-build places some capabilities under `_meta.modelState`; this module centralizes that real shape.
 */

import type {
  AvailableCommand,
  AvailableModel,
  InitializeResult,
} from "./types.js";

/** Display data that can be projected onto SessionState immediately after initialize. */
export type InitializeSessionMetadata = {
  /** Current model id from agent modelState / first availableModels entry. */
  model: string;
  /** Normalized agent model catalog for the picker; empty when agent omitted it. */
  availableModels: AvailableModel[];
  availableCommands: AvailableCommand[];
};

/**
 * Convert an untrusted agent command array into a safe snapshot the input box can consume.
 * @param value Any `availableCommands` value from ACP events or initialize metadata.
 * @returns Commands with valid names only; missing fields, type errors, or duplicate names are filtered out.
 */
export function normalizeAvailableCommands(value: unknown): AvailableCommand[] {
  const rawCommands = Array.isArray(value) ? value : [];
  const names = new Set<string>();
  const commands: AvailableCommand[] = [];

  for (const rawCommand of rawCommands) {
    const record = asRecord(rawCommand);
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const description =
      typeof record?.description === "string" ? record.description : undefined;
    const inputRecord = asRecord(record?.input);
    /** input: null means no input; when an object, take hint; otherwise undefined. */
    let input: AvailableCommand["input"];
    if (record?.input === null) {
      input = null;
    } else if (inputRecord) {
      input = {
        hint:
          typeof inputRecord.hint === "string" ? inputRecord.hint : undefined,
      };
    }
    const meta = asRecord(record?._meta);

    if (!name || names.has(name)) {continue;}
    names.add(name);
    commands.push({
      name,
      description,
      input,
      _meta: meta ?? undefined,
    });
  }

  return commands;
}

/**
 * Convert an untrusted agent model array into a stable picker catalog.
 * Supports `{ id|modelId|value, name|label }` objects and bare model id strings.
 * @param value Any `availableModels` value from initialize, session/new, or session/load.
 * @returns Deduped models with non-empty ids only; corrupt entries are dropped.
 */
export function normalizeAvailableModels(value: unknown): AvailableModel[] {
  const rawModels = Array.isArray(value) ? value : [];
  const ids = new Set<string>();
  const models: AvailableModel[] = [];

  for (const rawModel of rawModels) {
    if (typeof rawModel === "string") {
      const id = rawModel.trim();
      if (!id || ids.has(id)) {
        continue;
      }
      ids.add(id);
      models.push({ id });
      continue;
    }
    const record = asRecord(rawModel);
    if (!record) {
      continue;
    }
    const id = String(
      record.id ?? record.modelId ?? record.value ?? record.name ?? "",
    ).trim();
    if (!id || ids.has(id)) {
      continue;
    }
    ids.add(id);
    const nameRaw = record.name ?? record.label;
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
    models.push(name ? { id, name } : { id });
  }

  return models;
}

/**
 * Extract model, model catalog, and commands from the initialize result.
 * Supports standard top-level fields and grok-build shapes:
 * - models: `_meta.modelState.availableModels` / top-level `availableModels`
 * - commands: top-level `availableCommands`, then `_meta.availableCommands`
 *   (real grok-build places the slash catalog on `_meta`, not under `modelState`)
 * @param init Successful initialize result; returns empty strings/arrays when not an object or fields are corrupt.
 * @returns Display metadata that can be written into a new session without throwing protocol parse errors.
 */
export function extractInitializeSessionMetadata(
  init: InitializeResult,
): InitializeSessionMetadata {
  const initRecord = asRecord(init) ?? {};
  const meta = asRecord(initRecord._meta);
  const modelState = asRecord(meta?.modelState);
  const rawModels =
    asArray(initRecord.availableModels) ?? asArray(modelState?.availableModels);
  const availableModels = normalizeAvailableModels(rawModels);
  const currentModelId =
    typeof modelState?.currentModelId === "string"
      ? modelState.currentModelId
      : "";
  /** Prefer first non-empty source so empty top-level arrays do not hide `_meta.availableCommands`. */
  const rawCommands =
    firstNonEmptyArray(
      initRecord.availableCommands,
      meta?.availableCommands,
      modelState?.availableCommands,
    ) ?? [];
  const commands = normalizeAvailableCommands(rawCommands);

  return {
    model: currentModelId || availableModels[0]?.id || "",
    availableModels,
    availableCommands: commands,
  };
}

/**
 * Prefer the first argument that is a non-empty array.
 * @param candidates Untrusted protocol values; non-arrays and empty arrays are skipped.
 * @returns First usable array, or undefined when every candidate is empty/invalid.
 */
function firstNonEmptyArray(
  ...candidates: unknown[]
): unknown[] | undefined {
  for (const candidate of candidates) {
    const arr = asArray(candidate);
    if (arr && arr.length > 0) {
      return arr;
    }
  }
  return undefined;
}

/**
 * Extract the current model id from a session/new or session/load result.
 * grok-build shape: `{ models: { currentModelId, availableModels } }`.
 * @param result RPC result; returns empty string on corruption without throwing.
 * @returns String suitable for SessionState.model; empty string when absent.
 */
export function extractModelFromSessionResult(result: unknown): string {
  const root = asRecord(result);
  if (!root) {return "";}
  const models = asRecord(root.models);
  if (typeof models?.currentModelId === "string" && models.currentModelId) {
    return models.currentModelId;
  }
  if (typeof root.currentModelId === "string" && root.currentModelId) {
    return root.currentModelId;
  }
  const available = extractAvailableModelsFromSessionResult(result);
  return available[0]?.id || "";
}

/**
 * Extract the agent model catalog from a session/new or session/load result.
 * Prefer nested `models.availableModels`, then top-level `availableModels`.
 * @param result RPC result; returns [] on corruption without throwing.
 * @returns Normalized catalog for SessionState.availableModels.
 */
export function extractAvailableModelsFromSessionResult(
  result: unknown,
): AvailableModel[] {
  const root = asRecord(result);
  if (!root) {
    return [];
  }
  const models = asRecord(root.models);
  const raw =
    asArray(models?.availableModels) ?? asArray(root.availableModels);
  return normalizeAvailableModels(raw);
}

/**
 * Safely read a plain object; arrays, null, and primitives are treated as invalid.
 * @param value Unvalidated protocol value.
 * @returns Indexable record, or undefined when the type does not match.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Safely read an array so strings and other iterables are not mistaken for command/model lists.
 * @param value Unvalidated protocol value.
 * @returns The original array or undefined; callers supply empty-array fallbacks.
 */
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
