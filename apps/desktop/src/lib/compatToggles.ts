/**
 * Claude/Cursor/Agents compat env toggles (F-COMPAT-03).
 * Checklist documents 10 GROK_*_ENABLED switches — full set below.
 * Values pass to child spawn env as "1"/"0".
 */

export type CompatToggle = {
  envKey: string;
  label: string;
  /** Default when unset (upstream docs often default on for compat). */
  defaultEnabled: boolean;
};

/**
 * All 10 documented compat scan switches.
 * Order matches settings UI: Claude (5) → Cursor (3) → Agents (2).
 */
export const COMPAT_TOGGLES: CompatToggle[] = [
  {
    envKey: "GROK_CLAUDE_SKILLS_ENABLED",
    label: "Claude skills",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CLAUDE_MCP_ENABLED",
    label: "Claude MCP",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CLAUDE_HOOKS_ENABLED",
    label: "Claude hooks",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CLAUDE_AGENTS_ENABLED",
    label: "Claude agents",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CLAUDE_RULES_ENABLED",
    label: "Claude rules",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CURSOR_MCP_ENABLED",
    label: "Cursor MCP",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CURSOR_RULES_ENABLED",
    label: "Cursor rules",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_CURSOR_HOOKS_ENABLED",
    label: "Cursor hooks",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_AGENTS_SKILLS_ENABLED",
    label: "~/.agents skills",
    defaultEnabled: true,
  },
  {
    envKey: "GROK_AGENTS_COMMANDS_ENABLED",
    label: "~/.agents commands",
    defaultEnabled: true,
  },
];

/** Required count for F-COMPAT-03 (checklist: 10 switches). */
export const COMPAT_TOGGLE_COUNT = 10;

/**
 * Build env bag for spawn from toggle map (1/0 strings).
 * @param values Map of envKey → enabled.
 */
export function compatTogglesToEnv(
  values: Record<string, boolean>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const t of COMPAT_TOGGLES) {
    if (Object.prototype.hasOwnProperty.call(values, t.envKey)) {
      env[t.envKey] = values[t.envKey] ? "1" : "0";
    }
  }
  return env;
}

/**
 * Whether the catalog is the full checklist set of 10.
 */
export function isFullCompatToggleSet(): boolean {
  return (
    COMPAT_TOGGLES.length === COMPAT_TOGGLE_COUNT &&
    COMPAT_TOGGLES.every((t) => t.envKey.startsWith("GROK_") && t.envKey.endsWith("_ENABLED"))
  );
}
