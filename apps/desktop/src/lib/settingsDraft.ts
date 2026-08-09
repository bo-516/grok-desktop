/**
 * Pure helpers for Settings SPAWN draft vs applied snapshot (dirty detection).
 * Purpose: keep SettingsPanelWidget thin; unit-test dirty without React.
 * Boundary: no I/O; callers pass plain draft objects.
 */

import type { SandboxProfileId } from "./sandboxProfiles";

/** Fields that require session restart when changed (SPAWN flags). */
export type SettingsSpawnDraft = {
  sandbox: SandboxProfileId;
  worktree: boolean;
  alwaysApprove: boolean;
  webFetch: boolean;
  noSubagents: boolean;
  effort: string;
  denyRule: string;
  allowRule: string;
  compat: Record<string, boolean>;
};

/**
 * Deep-ish equality for SPAWN draft snapshots (compat keys order-insensitive).
 * @param a First draft.
 * @param b Second draft.
 * @returns true when every SPAWN field matches.
 */
export function settingsDraftEqual(
  a: SettingsSpawnDraft,
  b: SettingsSpawnDraft,
): boolean {
  if (
    a.sandbox !== b.sandbox ||
    a.worktree !== b.worktree ||
    a.alwaysApprove !== b.alwaysApprove ||
    a.webFetch !== b.webFetch ||
    a.noSubagents !== b.noSubagents ||
    a.effort !== b.effort ||
    a.denyRule !== b.denyRule ||
    a.allowRule !== b.allowRule
  ) {
    return false;
  }
  const keys = new Set([
    ...Object.keys(a.compat),
    ...Object.keys(b.compat),
  ]);
  for (const k of keys) {
    if (Boolean(a.compat[k]) !== Boolean(b.compat[k])) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the working draft differs from the last-applied snapshot.
 * @param draft Current form state.
 * @param applied Last applied (or initial defaults) snapshot.
 * @returns true when Apply should be enabled / close needs confirm.
 */
export function isSettingsDraftDirty(
  draft: SettingsSpawnDraft,
  applied: SettingsSpawnDraft,
): boolean {
  return !settingsDraftEqual(draft, applied);
}

/**
 * Default SPAWN draft from compat toggle defaults.
 * @param compatDefaults Map of envKey → defaultEnabled.
 */
export function createDefaultSettingsDraft(
  compatDefaults: Record<string, boolean>,
): SettingsSpawnDraft {
  return {
    sandbox: "off",
    worktree: false,
    alwaysApprove: false,
    webFetch: false,
    noSubagents: false,
    effort: "high",
    denyRule: "Bash(rm -rf *)",
    allowRule: "Bash(git *)",
    compat: { ...compatDefaults },
  };
}
