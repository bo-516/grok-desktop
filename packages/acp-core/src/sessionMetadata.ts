/**
 * Fault-tolerant normalization for ACP initialize and command metadata.
 * grok-build places some capabilities under `_meta.modelState`; this module centralizes that real shape.
 */

import type {
  AvailableCommand,
  AvailableModel,
  AvailableReasoningEffort,
  InitializeResult,
  SessionState,
} from "./types.js";
import { mergeAvailableModelsPreferContext } from "./sessionStateMerge.js";

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
    const name =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
    /**
     * Context window lives on model `_meta.totalContextTokens` (probe-confirmed
     * for grok-build). Also accept a top-level field so hand-rolled catalogs work.
     */
    const meta = asRecord(record._meta);
    const totalContextTokens = readPositiveInt(
      meta?.totalContextTokens ?? record.totalContextTokens,
    );
    const reasoningEfforts = readReasoningEfforts(
      meta?.reasoning_efforts ??
        meta?.reasoningEfforts ??
        record.reasoning_efforts ??
        record.reasoningEfforts,
    );
    const model: AvailableModel = name ? { id, name } : { id };
    if (totalContextTokens !== undefined) {
      model.totalContextTokens = totalContextTokens;
    }
    if (reasoningEfforts) {
      model.reasoningEfforts = reasoningEfforts;
    }
    models.push(model);
  }

  return models;
}

/**
 * Parse grok-build `_meta.reasoning_efforts` (or a top-level alias) into catalog rows.
 * Accepts `{ id|value, label|name, default? }` objects and bare id strings.
 * @param value Untrusted array from initialize / session model catalog.
 * @returns Deduped rows, or undefined when nothing valid was present.
 */
function readReasoningEfforts(
  value: unknown,
): AvailableReasoningEffort[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const out: AvailableReasoningEffort[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string") {
      const effortId = item.trim();
      if (!effortId || seen.has(effortId)) {
        continue;
      }
      seen.add(effortId);
      out.push({ id: effortId });
      continue;
    }
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    const effortId = String(rec.id ?? rec.value ?? "").trim();
    if (!effortId || seen.has(effortId)) {
      continue;
    }
    seen.add(effortId);
    const labelRaw = rec.label ?? rec.name;
    const label =
      typeof labelRaw === "string" && labelRaw.trim()
        ? labelRaw.trim()
        : undefined;
    const row: AvailableReasoningEffort = { id: effortId };
    if (label) {
      row.label = label;
    }
    if (rec.default === true) {
      row.default = true;
    }
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Read a positive integer from an untrusted model field.
 * @param value Protocol number or numeric string; fractions are rejected.
 * @returns Integer ≥ 1, or undefined when absent / invalid.
 */
function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1) {
      return Math.floor(n);
    }
  }
  return undefined;
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

/**
 * Prefer a non-empty command snapshot over an empty fallback.
 * Empty arrays are treated as missing so `??` alone cannot hide initialize / update data.
 * @param preferred Live interim or seed commands (may be empty/undefined).
 * @param fallback Initialize metadata or later catalog.
 * @returns First non-empty list, or an empty array when both are empty.
 */
export function preferCommands(
  preferred: AvailableCommand[] | undefined,
  fallback: AvailableCommand[] | undefined,
): AvailableCommand[] {
  if (preferred && preferred.length > 0) {
    return preferred;
  }
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return preferred ?? fallback ?? [];
}

/**
 * Pick availableModels after session/new|load: loaded list, then current, then init.
 * Thin session catalogs often keep names / efforts but drop totalContextTokens;
 * fill those gaps from initialize so the composer tip can show "0 of N filled"
 * instead of the "No turns yet" fallback.
 * @param loaded From session/new or session/load result.
 * @param current Existing client state.
 * @param fromInit From initialize metadata (source of missing window / effort).
 */
export function resolveAvailableModels(
  loaded: NonNullable<SessionState["availableModels"]>,
  current: SessionState["availableModels"] | undefined,
  fromInit: NonNullable<SessionState["availableModels"]>,
): NonNullable<SessionState["availableModels"]> {
  const picked =
    loaded.length > 0
      ? loaded
      : current && current.length > 0
        ? current
        : fromInit;
  return (
    mergeAvailableModelsPreferContext(picked, fromInit) ?? picked
  );
}

/**
 * Map reverse-handler throw to JSON-RPC error code (-32601 for method-not-found).
 * @param code Numeric code from error object, or fallback.
 * @param msg Error message text.
 */
export function resolveReverseErrorCode(code: number, msg: string): number {
  if (code === -32601 || /method not (found|implemented)/i.test(msg)) {
    return -32601;
  }
  return code;
}
