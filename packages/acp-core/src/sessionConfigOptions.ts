/**
 * configOptions from session/new, session/load, and config_option_update.
 * grok-build puts the live model and reasoning_effort selects on the RPC
 * result. Keeping only in-flight notifications drops them when the agent
 * answers on the result and never notifies first.
 */

/**
 * Safely read a plain object; arrays, null, and primitives are invalid.
 * @param value Unvalidated protocol value.
 * @returns Indexable record, or undefined when the type does not match.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Safely read an array so a string is not treated as a list of options.
 * @param value Unvalidated protocol value.
 * @returns The original array, or undefined when the type does not match.
 */
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Read configOptions from a session/new or session/load result.
 * Top-level `configOptions` wins; `_meta.configOptions` is the fallback.
 * An empty array is missing so it cannot hide the other source.
 * @param result RPC result; non-objects yield [].
 * @returns The first non-empty list, or [] when both sources are empty.
 *          Callers must not invent options from [].
 */
export function extractConfigOptions(result: unknown): unknown[] {
  const root = asRecord(result);
  if (!root) {
    return [];
  }
  const top = asArray(root.configOptions);
  if (top && top.length > 0) {
    return top;
  }
  const meta = asRecord(root._meta);
  const nested = asArray(meta?.configOptions);
  if (nested && nested.length > 0) {
    return nested;
  }
  return [];
}

/**
 * Keep the first non-empty config snapshot.
 * @param preferred RPC result list. Empty is missing, not a clear.
 * @param fallback In-flight config_option_update already on the session.
 * @returns Preferred when it has rows; otherwise fallback; undefined when both
 *          are missing. An empty preferred must not wipe a fallback.
 */
export function preferConfigOptions(
  preferred: unknown[] | undefined,
  fallback: unknown[] | undefined,
): unknown[] | undefined {
  if (preferred && preferred.length > 0) {
    return preferred;
  }
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return preferred ?? fallback;
}
