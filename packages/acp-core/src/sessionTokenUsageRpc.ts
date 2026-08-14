/**
 * Occupancy parsers for ACP `usage_update` and `session/token_usage`.
 * Kept beside sessionTokenUsage.ts so the billed-bag module stays under the
 * line cap. No I/O — reducers and the desktop backfill share one path.
 */

import {
  parseUsageBag,
  type SessionTokenUsage,
} from "./sessionTokenUsage.js";

/**
 * Read a finite non-negative number from an untrusted bag.
 * @param value Protocol field; strings and NaN are rejected.
 * @returns Finite number ≥ 0, or undefined when absent / invalid.
 */
function readNonNegNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * Parse ACP `usage_update` (`used` / `size`) or a billed usage bag on the
 * same kind. grok-build 1.x still prefers `turn_completed` + envelope
 * `totalTokens`; this path is the standardized occupancy notification.
 * @param update Raw session update; only `usage_update` is accepted.
 * @returns Snapshot with occupancy on `contextTokensUsed` when `used` is present.
 */
export function parseUsageUpdate(update: {
  sessionUpdate?: string;
  [key: string]: unknown;
}): SessionTokenUsage | null {
  if (update.sessionUpdate !== "usage_update") {
    return null;
  }
  const used = readNonNegNumber(update.used);
  const bag = parseUsageBag(update) ?? parseUsageBag(update.usage);
  if (bag) {
    if (used !== undefined) {
      return { ...bag, contextTokensUsed: used };
    }
    return bag;
  }
  if (used === undefined) {
    return null;
  }
  return {
    inputTokens: used,
    outputTokens: 0,
    totalTokens: used,
    contextTokensUsed: used,
  };
}

/**
 * Parse `session/token_usage` / cli_result data into a usage snapshot.
 * Prefers occupancy fields (`used`, `contextTokensUsed`) over billed
 * `totalTokens` — the billed sum can exceed the model window.
 * Walks common wrappers (`usage`, `data`, `_meta`, `result`) so thin
 * bridges and the raw ACP result share one parser.
 * @param raw Untrusted RPC result; non-objects return null.
 * @returns Snapshot when occupancy or the three core counters are present.
 */
export function parseTokenUsageRpc(raw: unknown): SessionTokenUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const seen = new Set<unknown>();
  const queue: unknown[] = [raw];
  let bestBag: SessionTokenUsage | null = null;
  let bestUsed: number | undefined;
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || seen.has(cur)) {
      continue;
    }
    seen.add(cur);
    const rec = cur as Record<string, unknown>;
    const used =
      readNonNegNumber(rec.used) ?? readNonNegNumber(rec.contextTokensUsed);
    if (used !== undefined && (bestUsed === undefined || used > 0)) {
      bestUsed = used;
    }
    const bag = parseUsageBag(rec);
    if (bag && !bestBag) {
      bestBag = bag;
    }
    for (const key of ["usage", "data", "_meta", "result"]) {
      if (rec[key] !== undefined) {
        queue.push(rec[key]);
      }
    }
  }
  if (bestBag) {
    if (bestUsed !== undefined) {
      return { ...bestBag, contextTokensUsed: bestUsed };
    }
    return bestBag;
  }
  if (bestUsed === undefined) {
    return null;
  }
  return {
    inputTokens: bestUsed,
    outputTokens: 0,
    totalTokens: bestUsed,
    contextTokensUsed: bestUsed,
  };
}

/**
 * True when the snapshot already has live window fill (not just billed input).
 * Used to skip restore backfill once occupancy has landed.
 * @param usage Session token snapshot; missing / 0 occupancy → false.
 */
export function hasLiveContextOccupancy(
  usage: SessionTokenUsage | null | undefined,
): boolean {
  return (
    typeof usage?.contextTokensUsed === "number" &&
    Number.isFinite(usage.contextTokensUsed) &&
    usage.contextTokensUsed > 0
  );
}
