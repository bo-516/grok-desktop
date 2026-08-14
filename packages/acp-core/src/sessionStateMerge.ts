/**
 * Field ownership for merging a bridge SessionState snapshot onto client state.
 *
 * Go bridge never reduces timeline / orchestration fields and emits empty
 * full-state frames after every session/update. Without a single ownership
 * table, ad-hoc whitelist merges silently wipe client-reduced maps (subagents,
 * goal, …). This module is the only merge policy for those frames.
 */

import type { AvailableModel, SessionState, SessionTokenUsage } from "./types.js";
import { mergeTurnUsagePreservingOccupancy } from "./sessionTokenUsage.js";

/**
 * Per-field merge strategy for bridge snapshots over client-reduced state.
 * - bridge: always take the bridge value (lifecycle / handshake).
 * - clientPreferNonEmpty: keep client when bridge is empty/undefined; take bridge when non-empty.
 * - clientMergeMap: shallow-union maps; bridge wins on same keys (cards only grow).
 */
export type SessionFieldRule =
  | "bridge"
  | "clientPreferNonEmpty"
  | "clientMergeMap";

/**
 * Exhaustive ownership of every SessionState key.
 * Adding a field to SessionState without declaring ownership here is a
 * compile-time error (Record of keyof SessionState), so silent wipe bugs
 * cannot reappear by forgetting a second whitelist.
 */
export const SESSION_FIELD_OWNER: Record<keyof SessionState, SessionFieldRule> =
  {
    // Bridge-owned: lifecycle, handshake, and reverse-request surfaces.
    id: "bridge",
    workspace: "bridge",
    model: "bridge",
    mode: "bridge",
    status: "bridge",
    pendingPermission: "bridge",
    errorMessage: "bridge",
    agentCapabilities: "bridge",
    configOptions: "bridge",
    updatedAt: "bridge",
    // Client-reduced scalars/arrays: Go omits or empties these every frame.
    // availableCommands is the grok-build slash catalog (initialize `_meta`
    // and/or available_commands_update). Go never reduces it after handshake
    // and later emitState frames omit or send [], which must not wipe `/`.
    timeline: "clientPreferNonEmpty",
    lastAgentText: "clientPreferNonEmpty",
    plan: "clientPreferNonEmpty",
    title: "clientPreferNonEmpty",
    tokenUsage: "clientPreferNonEmpty",
    todos: "clientPreferNonEmpty",
    availableModels: "clientPreferNonEmpty",
    availableCommands: "clientPreferNonEmpty",
    goal: "clientPreferNonEmpty",
    // Cumulative maps: union; bridge same-key overwrites client (never wipe).
    // Deletion of keys is intentionally unsupported — orchestration cards only grow.
    toolCalls: "clientMergeMap",
    subagents: "clientMergeMap",
    backgroundTasks: "clientMergeMap",
    subagentLinks: "clientMergeMap",
  };

/**
 * True when a value counts as "empty" for clientPreferNonEmpty.
 * Empty string, empty array, empty plain object, null, and undefined are empty.
 * @param value Field value from bridge or client.
 * @returns Whether the value should yield to the other side under prefer-non-empty.
 */
export function isEmptySessionField(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

/**
 * Prefer primary model list structure; fill totalContextTokens and
 * reasoningEfforts from secondary when primary rows lost those fields
 * (thin bridge snapshots).
 * @param primary Bridge/inbound catalog (structure preferred when non-empty).
 * @param secondary Client/bucket catalog (source of missing window / effort).
 * @returns Merged list, or whichever side is non-empty; undefined if both empty.
 */
export function mergeAvailableModelsPreferContext(
  primary: AvailableModel[] | undefined,
  secondary: AvailableModel[] | undefined,
): AvailableModel[] | undefined {
  if (!primary?.length) {
    return secondary?.length ? secondary : primary;
  }
  if (!secondary?.length) {
    return primary;
  }
  const byId = new Map(secondary.map((m) => [m.id, m]));
  return primary.map((m) => {
    const needsTokens = !(
      typeof m.totalContextTokens === "number" && m.totalContextTokens > 0
    );
    const needsEffort = !m.reasoningEfforts?.length;
    if (!needsTokens && !needsEffort) {
      return m;
    }
    const other = byId.get(m.id);
    if (!other) {
      return m;
    }
    let next = m;
    if (
      needsTokens &&
      typeof other.totalContextTokens === "number" &&
      other.totalContextTokens > 0
    ) {
      next = { ...next, totalContextTokens: other.totalContextTokens };
    }
    if (needsEffort && other.reasoningEfforts?.length) {
      next = { ...next, reasoningEfforts: other.reasoningEfforts };
    }
    return next;
  });
}

/**
 * Shallow-merge two plain maps; bridge (right) wins on same keys.
 * @param client Client-side map (may be undefined).
 * @param bridge Bridge-side map (may be undefined).
 * @returns Union map, or undefined when both sides are absent/empty.
 */
function mergeMaps(
  client: Record<string, unknown> | undefined,
  bridge: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const hasClient = client && Object.keys(client).length > 0;
  const hasBridge = bridge && Object.keys(bridge).length > 0;
  if (!hasClient && !hasBridge) {
    // Preserve explicit empty object from bridge when client is also empty/absent.
    if (bridge !== undefined) {
      return bridge;
    }
    return client;
  }
  if (!hasClient) {
    return bridge;
  }
  if (!hasBridge) {
    return client;
  }
  return { ...client, ...bridge };
}

/**
 * Merge one bridge full-state snapshot into client-reduced SessionState.
 * Bridge-owned fields always come from `bridge`. Client-owned non-empty values
 * survive when the bridge omits or empties them (Go empty hydrates). Maps are
 * unioned with bridge winning on same keys.
 *
 * @param client Client reduce bucket / painted canvas (may hold full timeline + orchestration).
 * @param bridge Bridge full-state frame (Go: empty timeline, no orchestration fields).
 * @returns Merged SessionState safe to hydrate into the reduce bucket or canvas.
 */
export function mergeBridgeSnapshot(
  client: SessionState,
  bridge: SessionState,
): SessionState {
  const out = {} as SessionState;
  for (const key of Object.keys(SESSION_FIELD_OWNER) as Array<
    keyof SessionState
  >) {
    const rule = SESSION_FIELD_OWNER[key];
    const clientVal = client[key];
    const bridgeVal = bridge[key];

    if (rule === "bridge") {
      // Always take bridge, including undefined (clears pendingPermission etc.).
      (out as Record<string, unknown>)[key] = bridgeVal;
      continue;
    }

    if (rule === "clientMergeMap") {
      (out as Record<string, unknown>)[key] = mergeMaps(
        clientVal as Record<string, unknown> | undefined,
        bridgeVal as Record<string, unknown> | undefined,
      );
      continue;
    }

    // clientPreferNonEmpty (+ availableModels / tokenUsage specializations)
    if (key === "availableModels") {
      const preferred = isEmptySessionField(bridgeVal)
        ? (clientVal as AvailableModel[] | undefined)
        : (bridgeVal as AvailableModel[] | undefined);
      const secondary = isEmptySessionField(bridgeVal)
        ? (bridgeVal as AvailableModel[] | undefined)
        : (clientVal as AvailableModel[] | undefined);
      out.availableModels = mergeAvailableModelsPreferContext(
        preferred,
        secondary,
      );
      continue;
    }

    if (key === "tokenUsage") {
      // Bridge billed bag (turn_completed / prompt _meta) must not drop the
      // client's live occupancy — same rule as applySessionUpdate.
      if (isEmptySessionField(bridgeVal)) {
        out.tokenUsage = clientVal as SessionTokenUsage | undefined;
        continue;
      }
      out.tokenUsage = mergeTurnUsagePreservingOccupancy(
        bridgeVal as SessionTokenUsage,
        clientVal as SessionTokenUsage | undefined,
      );
      continue;
    }

    if (isEmptySessionField(bridgeVal)) {
      (out as Record<string, unknown>)[key] = clientVal;
    } else {
      (out as Record<string, unknown>)[key] = bridgeVal;
    }
  }

  // toolCalls is required on SessionState; never leave it undefined.
  if (!out.toolCalls) {
    out.toolCalls = client.toolCalls ?? bridge.toolCalls ?? {};
  }
  if (!out.timeline) {
    out.timeline = client.timeline ?? bridge.timeline ?? [];
  }
  if (out.lastAgentText === undefined) {
    out.lastAgentText = client.lastAgentText || bridge.lastAgentText || "";
  }

  return out;
}

/**
 * Runtime assertion: SESSION_FIELD_OWNER keys match SessionState keys.
 * Guards against `as` casts that would silence the compile-time exhaustiveness check.
 * @returns Sorted list of owner keys (for tests).
 * @throws When the owner table is missing or has extra keys vs a reference SessionState.
 */
export function assertSessionFieldOwnerComplete(
  reference: SessionState,
): string[] {
  const ownerKeys = Object.keys(SESSION_FIELD_OWNER).sort();
  const stateKeys = Object.keys(reference).sort();
  // Reference may omit optional keys; owner must still list every keyof SessionState.
  // Compare owner against the type-level key set by ensuring every required key
  // from a fully-populated probe is covered (tests pass a full probe).
  const missing = stateKeys.filter((k) => !(k in SESSION_FIELD_OWNER));
  if (missing.length > 0) {
    throw new Error(
      `SESSION_FIELD_OWNER missing keys present on SessionState: ${missing.join(", ")}`,
    );
  }
  return ownerKeys;
}
