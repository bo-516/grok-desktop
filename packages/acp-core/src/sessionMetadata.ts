/**
 * Fault-tolerant normalization for ACP initialize and command metadata.
 * grok-build places some capabilities under `_meta.modelState`; this module centralizes that real shape.
 */

import type { AvailableCommand, InitializeResult } from "./types.js";

/** Display data that can be projected onto SessionState immediately after initialize. */
export type InitializeSessionMetadata = {
  model: string;
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
 * Extract model and commands from the initialize result; supports standard top-level fields and grok-build `_meta.modelState`.
 * @param init Successful initialize result; returns empty string and empty array when not an object or fields are corrupt.
 * @returns Display metadata that can be written into a new session without throwing protocol parse errors.
 */
export function extractInitializeSessionMetadata(
  init: InitializeResult,
): InitializeSessionMetadata {
  const initRecord = asRecord(init) ?? {};
  const meta = asRecord(initRecord._meta);
  const modelState = asRecord(meta?.modelState);
  const models =
    asArray(initRecord.availableModels) ?? asArray(modelState?.availableModels);
  const currentModelId =
    typeof modelState?.currentModelId === "string"
      ? modelState.currentModelId
      : "";
  const firstModel = asRecord(models?.[0]);
  /** Fallback model id order: id → modelId → name. */
  let fallbackModel = "";
  if (typeof firstModel?.id === "string") {
    fallbackModel = firstModel.id;
  } else if (typeof firstModel?.modelId === "string") {
    fallbackModel = firstModel.modelId;
  } else if (typeof firstModel?.name === "string") {
    fallbackModel = firstModel.name;
  }
  const commands = normalizeAvailableCommands(
    initRecord.availableCommands ?? modelState?.availableCommands,
  );

  return { model: currentModelId || fallbackModel, availableCommands: commands };
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
  const available =
    asArray(models?.availableModels) ?? asArray(root.availableModels);
  const first = asRecord(available?.[0]);
  if (!first) {return "";}
  if (typeof first.modelId === "string") {return first.modelId;}
  if (typeof first.id === "string") {return first.id;}
  if (typeof first.name === "string") {return first.name;}
  return "";
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
