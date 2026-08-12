/**
 * ACP session fork helpers for `_x.ai/session/fork`.
 * Pure param builders + result parsers; the RPC itself lives on AcpClient.
 * Wrong / missing source ids produce agent Invalid params, not client crashes.
 */

/** Params the live agent accepts for `_x.ai/session/fork`. */
export type SessionForkParams = {
  /** Source (parent) session id to copy history from. */
  sourceSessionId: string;
  /** Absolute workspace of the source session. */
  sourceCwd: string;
  /**
   * Absolute workspace for the forked peer.
   * Same as sourceCwd for a same-folder fork; a worktree path when isolating.
   */
  newCwd: string;
};

/** Successful `_x.ai/session/fork` result (camelCase as returned by grok-build). */
export type SessionForkResult = {
  /** New peer session id to load / select. */
  newSessionId: string;
  /** How many chat messages were copied into the child. */
  chatMessagesCopied?: number;
  /** How many timeline update rows were copied. */
  updatesCopied?: number;
  /** Whether plan state was duplicated. */
  planStateCopied?: boolean;
  /** Effective cwd of the child (may differ when worktree was created). */
  newCwd?: string;
  /** Parent session id echoed by the agent. */
  parentSessionId?: string;
};

/**
 * Build `_x.ai/session/fork` params after trimming required paths/ids.
 * @param input Raw source id + cwd pair; missing fields yield null (do not call RPC).
 * @param newCwd Optional child workspace; defaults to sourceCwd for same-folder forks.
 * @returns Params bag, or null when sourceSessionId / sourceCwd is empty.
 */
export function buildSessionForkParams(
  input: { sourceSessionId: string; sourceCwd: string },
  newCwd?: string,
): SessionForkParams | null {
  const sourceSessionId = input.sourceSessionId.trim();
  const sourceCwd = input.sourceCwd.trim();
  if (!sourceSessionId || !sourceCwd) {
    return null;
  }
  const childCwd = (newCwd ?? sourceCwd).trim() || sourceCwd;
  return {
    sourceSessionId,
    sourceCwd,
    newCwd: childCwd,
  };
}

/**
 * Parse an unknown RPC result into a fork result when `newSessionId` is present.
 * Accepts camelCase (agent) and snake_case aliases for resilience.
 * @param data Raw JSON-RPC result body.
 * @returns Structured result, or null when the agent did not return a child id.
 */
export function parseSessionForkResult(data: unknown): SessionForkResult | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const rec = data as Record<string, unknown>;
  const newSessionId = firstString(rec, ["newSessionId", "new_session_id", "sessionId"]);
  if (!newSessionId) {
    return null;
  }
  return {
    newSessionId,
    chatMessagesCopied: firstNumber(rec, [
      "chatMessagesCopied",
      "chat_messages_copied",
    ]),
    updatesCopied: firstNumber(rec, ["updatesCopied", "updates_copied"]),
    planStateCopied: firstBoolean(rec, ["planStateCopied", "plan_state_copied"]),
    newCwd: firstString(rec, ["newCwd", "new_cwd"]),
    parentSessionId: firstString(rec, [
      "parentSessionId",
      "parent_session_id",
      "sourceSessionId",
      "source_session_id",
    ]),
  };
}

/**
 * First non-empty string among keys.
 * @param rec Source record.
 * @param keys Preference order.
 */
function firstString(
  rec: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

/**
 * First finite number among keys, or undefined.
 * @param rec Source record.
 * @param keys Preference order.
 */
function firstNumber(
  rec: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

/**
 * First boolean among keys, or undefined.
 * @param rec Source record.
 * @param keys Preference order.
 */
function firstBoolean(
  rec: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "boolean") {
      return v;
    }
  }
  return undefined;
}
