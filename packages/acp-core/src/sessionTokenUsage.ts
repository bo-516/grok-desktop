/**
 * Pure helpers for agent turn_completed usage rollups.
 * Purpose: parse the real grok-build `usage` bag into SessionState.tokenUsage
 * without I/O so reducers and unit tests share one fault-tolerant path.
 * Boundary: never invent zeros for missing counters — omit the snapshot instead.
 * Does not import types.ts (SessionTokenUsage is defined here to avoid a cycle).
 */

/**
 * Last completed turn's token usage from `turn_completed.usage` or
 * `session/prompt` result `_meta` (same counter names).
 * Real grok-build shape (stable): input/output/total + optional cache/reasoning.
 * Unreported optional fields stay undefined — never collapse to 0 in the parser.
 */
export type SessionTokenUsage = {
  /** Tokens in the model input (best proxy for context-window fill). */
  inputTokens: number;
  /** Tokens the model generated this turn. */
  outputTokens: number;
  /** input + output for the completed turn (may span multiple modelCalls). */
  totalTokens: number;
  /** Cache hits read this turn, when the agent reports them. */
  cachedReadTokens?: number;
  /** Reasoning/thinking tokens, when the agent reports them. */
  reasoningTokens?: number;
  /** Number of model API calls rolled into this turn. */
  modelCalls?: number;
  /** Agent-reported turn counter for the rollup (not always 1). */
  numTurns?: number;
};

/**
 * Minimal update shape so this module never imports types.ts (cycle with
 * SessionState.tokenUsage). Callers pass the real SessionUpdate object.
 */
type TurnCompletedLike = {
  sessionUpdate?: string;
  usage?: unknown;
  [key: string]: unknown;
};

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
 * Parse a raw usage bag (turn_completed.usage or _meta.usage / _meta counters).
 * Requires the three core counters; optional cache/reasoning/modelCalls pass through.
 * @param raw Untrusted object; non-objects and partial bags return null.
 * @returns Snapshot when input/output/total are all present; otherwise null.
 */
export function parseUsageBag(raw: unknown): SessionTokenUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const bag = raw as Record<string, unknown>;
  const inputTokens = readNonNegNumber(bag.inputTokens);
  const outputTokens = readNonNegNumber(bag.outputTokens);
  const totalTokens = readNonNegNumber(bag.totalTokens);
  // All three core counters must be present — partial bags are not trustworthy.
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return null;
  }
  const cachedReadTokens = readNonNegNumber(bag.cachedReadTokens);
  const reasoningTokens = readNonNegNumber(bag.reasoningTokens);
  const modelCalls = readNonNegNumber(bag.modelCalls);
  const numTurns = readNonNegNumber(bag.numTurns);
  const out: SessionTokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
  };
  if (cachedReadTokens !== undefined) {
    out.cachedReadTokens = cachedReadTokens;
  }
  if (reasoningTokens !== undefined) {
    out.reasoningTokens = reasoningTokens;
  }
  if (modelCalls !== undefined) {
    out.modelCalls = modelCalls;
  }
  if (numTurns !== undefined) {
    out.numTurns = numTurns;
  }
  return out;
}

/**
 * Parse `turn_completed.usage` into a SessionTokenUsage snapshot.
 * Real shape (stable across 200+ live turns):
 * `{ inputTokens, outputTokens, totalTokens, cachedReadTokens?, … }`.
 * @param update Raw session update; only `sessionUpdate === "turn_completed"` is accepted.
 * @returns Snapshot when the three core counters are present; otherwise null
 *   so the UI can keep the previous reading instead of flashing zeros.
 */
export function parseTurnCompletedUsage(
  update: TurnCompletedLike,
): SessionTokenUsage | null {
  if (update.sessionUpdate !== "turn_completed") {
    return null;
  }
  return parseUsageBag(update.usage);
}

/**
 * Parse usage from a session/prompt RPC result.
 * grok-build places counters on `result._meta.usage` and also as top-level
 * `_meta.inputTokens` / `outputTokens` / `totalTokens` (probe-confirmed).
 * Used when `turn_completed` is not on the stdio wire so the composer ring
 * still fills after the first reply.
 * @param result Raw session/prompt result (or any object with `_meta`).
 * @returns Snapshot when three core counters are present; otherwise null.
 */
export function parsePromptResultUsage(
  result: unknown,
): SessionTokenUsage | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const root = result as Record<string, unknown>;
  const meta = root._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  const metaRec = meta as Record<string, unknown>;
  // Prefer nested usage bag (imagePrompt probe shape).
  const nested = parseUsageBag(metaRec.usage);
  if (nested) {
    return nested;
  }
  // Top-level _meta counters (slashContext probe shape; totalTokens may be 0).
  return parseUsageBag(metaRec);
}

/**
 * Build a `turn_completed` SessionUpdate from a usage snapshot so thin bridges
 * can relay prompt-result usage through the same UI reduce path as the vendor
 * stream (session_update → applySessionUpdate → tokenUsage).
 * @param usage Parsed core counters from prompt result or stream.
 * @returns Update object accepted by parseTurnCompletedUsage / applySessionUpdate.
 */
export function turnCompletedUpdateFromUsage(
  usage: SessionTokenUsage,
): TurnCompletedLike {
  const bag: Record<string, number> = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
  if (usage.cachedReadTokens !== undefined) {
    bag.cachedReadTokens = usage.cachedReadTokens;
  }
  if (usage.reasoningTokens !== undefined) {
    bag.reasoningTokens = usage.reasoningTokens;
  }
  if (usage.modelCalls !== undefined) {
    bag.modelCalls = usage.modelCalls;
  }
  if (usage.numTurns !== undefined) {
    bag.numTurns = usage.numTurns;
  }
  return {
    sessionUpdate: "turn_completed",
    usage: bag,
  };
}

/**
 * Context-window fill ratio for the last completed turn.
 * Uses `inputTokens` (what the model actually saw) over the advertised limit.
 * @param usage Last turn usage; null/undefined → null.
 * @param contextLimit Model totalContextTokens; ≤0 or missing → null.
 * @returns Percentage in [0, ∞); callers clamp the ring fill to 100.
 */
export function contextUsagePercent(
  usage: SessionTokenUsage | null | undefined,
  contextLimit: number | null | undefined,
): number | null {
  if (!usage || contextLimit == null || !(contextLimit > 0)) {
    return null;
  }
  return (usage.inputTokens / contextLimit) * 100;
}
