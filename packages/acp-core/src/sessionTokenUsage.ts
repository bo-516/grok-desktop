/**
 * Pure helpers for agent usage rollups and live context-window occupancy.
 * Purpose: parse grok-build `usage` bags and `params._meta.totalTokens` into
 * SessionState.tokenUsage without I/O so reducers and unit tests share one path.
 * Boundary: never invent zeros for missing counters — omit the snapshot instead.
 * Does not import types.ts (SessionTokenUsage is defined here to avoid a cycle).
 */

/**
 * Last known token usage for the composer context ring and turn rollup.
 * `inputTokens` / `outputTokens` / `totalTokens` are the last completed turn's
 * billed counters (`turn_completed.usage` or prompt `_meta`). Those sums can
 * exceed the model window across multiple modelCalls — they are not occupancy.
 * `contextTokensUsed` is the live window fill from `params._meta.totalTokens`
 * (matches on-disk `signals.json.contextTokensUsed` at turn end).
 * Unreported optional fields stay undefined — never collapse to 0 in the parser.
 */
export type SessionTokenUsage = {
  /** Billed input tokens for the last completed turn (sum across modelCalls). */
  inputTokens: number;
  /** Tokens the model generated this turn. */
  outputTokens: number;
  /** input + output for the completed turn (may span multiple modelCalls). */
  totalTokens: number;
  /**
   * Live context-window occupancy from grok-build `params._meta.totalTokens`.
   * Updated mid-turn as tools / model calls land; preferred over inputTokens
   * for the composer ring. Absent until the first stamped live update.
   */
  contextTokensUsed?: number;
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
  const contextTokensUsed = readNonNegNumber(bag.contextTokensUsed);
  const out: SessionTokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
  };
  if (contextTokensUsed !== undefined) {
    out.contextTokensUsed = contextTokensUsed;
  }
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
  if (usage.contextTokensUsed !== undefined) {
    bag.contextTokensUsed = usage.contextTokensUsed;
  }
  return {
    sessionUpdate: "turn_completed",
    usage: bag,
  };
}

/**
 * Occupancy for the context ring: live `_meta.totalTokens` when present,
 * otherwise last-turn billed `inputTokens` (older snapshots / first paint).
 * @param usage Session token snapshot; null/undefined → null.
 * @returns Non-negative token count, or null when usage is missing.
 */
export function contextTokensForWindow(
  usage: SessionTokenUsage | null | undefined,
): number | null {
  if (!usage) {
    return null;
  }
  if (
    typeof usage.contextTokensUsed === "number" &&
    Number.isFinite(usage.contextTokensUsed) &&
    usage.contextTokensUsed > 0
  ) {
    return usage.contextTokensUsed;
  }
  return usage.inputTokens;
}

/**
 * Context-window fill ratio for the composer ring.
 * Prefers live occupancy (`contextTokensUsed`) so a multi-call turn does not
 * flash billed `inputTokens` (often larger than the model window).
 * @param usage Latest usage snapshot; null/undefined → null.
 * @param contextLimit Model totalContextTokens; ≤0 or missing → null.
 * @returns Percentage in [0, ∞); callers clamp the ring fill to 100.
 */
export function contextUsagePercent(
  usage: SessionTokenUsage | null | undefined,
  contextLimit: number | null | undefined,
): number | null {
  const used = contextTokensForWindow(usage);
  if (used == null || contextLimit == null || !(contextLimit > 0)) {
    return null;
  }
  return (used / contextLimit) * 100;
}

/**
 * Read live occupancy from an extracted update's `_meta.totalTokens`.
 * grok-build stamps this on nearly every `session/update` params._meta; extract
 * copies it onto the update so the desktop reducer still sees it after relay.
 * @param update Extracted SessionUpdate or any bag that may carry `_meta`.
 * @returns Finite occupancy ≥ 0, or undefined when absent / invalid.
 */
export function readLiveContextTokens(update: {
  _meta?: unknown;
}): number | undefined {
  return readLiveContextTokensFromMeta(update._meta);
}

/**
 * Copy `params._meta.totalTokens` onto the extracted update's `_meta`.
 * The bridge relays only the inner `update` object; without this stamp the
 * desktop reduce never sees mid-turn occupancy.
 * @param update Inner sessionUpdate bag (may already have tool `_meta`).
 * @param paramsMeta Notification-level `_meta` from session/update params.
 * @returns Same object when there is nothing to stamp; a shallow copy otherwise.
 */
export function stampLiveContextTokens(
  update: Record<string, unknown>,
  paramsMeta: unknown,
): Record<string, unknown> {
  const live = readLiveContextTokensFromMeta(paramsMeta);
  if (live === undefined) {
    return update;
  }
  const existing = update._meta;
  const existingRec =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : null;
  if (existingRec && existingRec.totalTokens === live) {
    return update;
  }
  return {
    ...update,
    _meta: existingRec
      ? { ...existingRec, totalTokens: live }
      : { totalTokens: live },
  };
}

/**
 * Keep mid-turn occupancy when a `turn_completed` billed bag arrives.
 * turn_completed itself has no `_meta.totalTokens`; overwriting would drop
 * occupancy and the ring would jump to billed input (can exceed the window).
 * A previous occupancy of 0 is treated as unset — early `_meta.totalTokens: 0`
 * stamps must not mask a later billed bag or a real occupancy backfill.
 * @param usage Fresh billed snapshot from parseTurnCompletedUsage.
 * @param previous Current session.tokenUsage (may already hold occupancy).
 * @returns usage, or a copy with previous contextTokensUsed restored.
 */
export function mergeTurnUsagePreservingOccupancy(
  usage: SessionTokenUsage,
  previous: SessionTokenUsage | undefined,
): SessionTokenUsage {
  if (usage.contextTokensUsed !== undefined) {
    return usage;
  }
  const occ = previous?.contextTokensUsed;
  if (occ === undefined || occ <= 0) {
    return usage;
  }
  return { ...usage, contextTokensUsed: occ };
}

/**
 * Read a non-negative `totalTokens` off a `_meta` record.
 * @param meta Untrusted `_meta` bag.
 * @returns Finite number ≥ 0, or undefined when absent / invalid.
 */
function readLiveContextTokensFromMeta(meta: unknown): number | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  return readNonNegNumber((meta as Record<string, unknown>).totalTokens);
}

/**
 * Copy live occupancy from `_meta.totalTokens` onto tokenUsage when it changed.
 * Structural on purpose — this module must not import SessionState (cycle).
 * No-op when the stamp is missing or already applied so empty chunks keep
 * the same state reference.
 * @param state Session after the kind-specific reduce (needs tokenUsage).
 * @param update Extracted update (may carry stamped `_meta.totalTokens`).
 * @returns state, or a shallow copy with tokenUsage.contextTokensUsed updated.
 */
export function applyLiveContextOccupancy<
  T extends { tokenUsage?: SessionTokenUsage },
>(state: T, update: { _meta?: unknown }): T {
  const live = readLiveContextTokens(update);
  if (live === undefined) {
    return state;
  }
  const prev = state.tokenUsage;
  if (prev?.contextTokensUsed === live) {
    return state;
  }
  // Do not invent a zero-only snapshot before the first real stamp — that
  // would mark hasUsage and pin the composer ring at 0% for the rest of the
  // turn when later envelopes omit totalTokens (session/load replay).
  if (live === 0 && !prev) {
    return state;
  }
  const tokenUsage: SessionTokenUsage = prev
    ? { ...prev, contextTokensUsed: live }
    : {
        inputTokens: live,
        outputTokens: 0,
        totalTokens: live,
        contextTokensUsed: live,
      };
  return { ...state, tokenUsage };
}
