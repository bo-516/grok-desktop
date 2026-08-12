/**
 * Shared JSON coercion helpers for inspect / MCP normalizers.
 * Used by inspectNormalize and mcpMerge; product code imports from inspectModel.
 */

/**
 * Coerce an unknown value to a plain object or null.
 * @param value Raw CLI field.
 * @returns Object when value is a non-null object (not array); else null.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Coerce an unknown value to an array (empty when not an array).
 * @param value Raw CLI field.
 * @returns Array reference or empty array.
 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Read a string field with a default.
 * @param obj Record to read.
 * @param key Property name.
 * @param fallback Default when missing / non-string.
 */
export function str(
  obj: Record<string, unknown> | null,
  key: string,
  fallback = "",
): string {
  if (!obj) {
    return fallback;
  }
  const v = obj[key];
  return typeof v === "string" ? v : fallback;
}

/**
 * Read a boolean field with a default.
 * @param obj Record to read.
 * @param key Property name.
 * @param fallback Default when missing / non-boolean.
 */
export function bool(
  obj: Record<string, unknown> | null,
  key: string,
  fallback = false,
): boolean {
  if (!obj) {
    return fallback;
  }
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Read a finite number field when present.
 * @param obj Record to read.
 * @param key Property name.
 * @returns Number or undefined.
 */
export function num(
  obj: Record<string, unknown> | null,
  key: string,
): number | undefined {
  if (!obj) {
    return undefined;
  }
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Map and filter an array of raw items through a row normalizer.
 * @param items Raw CLI array (may be non-array).
 * @param mapFn Returns null to drop a bad element.
 */
export function mapRows<T>(
  items: unknown,
  mapFn: (raw: unknown) => T | null,
): T[] {
  const out: T[] = [];
  for (const item of asArray(items)) {
    const row = mapFn(item);
    if (row) {
      out.push(row);
    }
  }
  return out;
}
