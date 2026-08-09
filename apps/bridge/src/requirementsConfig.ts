/**
 * Read enterprise requirements.toml locks for UI greying (F-CFG-02).
 * Pure parser + merge; no network.
 */

/**
 * Parse a minimal TOML subset for `key = true/false/"string"` lines.
 * Good enough for requirements.toml permission locks without a full TOML dep.
 * @param text File contents.
 */
export function parseSimpleToml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!.trim();
      if (!out[section] || typeof out[section] !== "object") {
        out[section] = {};
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) {
      continue;
    }
    const key = kv[1]!;
    let val: unknown = kv[2]!.trim();
    if (val === "true") {
      val = true;
    } else if (val === "false") {
      val = false;
    } else if (
      typeof val === "string" &&
      val.startsWith('"') &&
      val.endsWith('"')
    ) {
      val = val.slice(1, -1);
    } else if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val)) {
      val = Number(val);
    }
    if (section) {
      const bag = out[section] as Record<string, unknown>;
      bag[key] = val;
    } else {
      out[key] = val;
    }
  }
  return out;
}

export type LockedSetting = {
  key: string;
  value: unknown;
  /** Human reason for greying the control. */
  reason: string;
};

/**
 * Extract UI-locked settings from requirements tables.
 * @param parsed Parsed requirements.toml.
 */
export function lockedSettingsFromRequirements(
  parsed: Record<string, unknown>,
): LockedSetting[] {
  const locks: LockedSetting[] = [];
  const perm = (parsed.permission ?? parsed.permissions) as
    | Record<string, unknown>
    | undefined;
  if (perm && perm.disable_bypass_permissions_mode === true) {
    locks.push({
      key: "always_approve",
      value: true,
      reason:
        "Locked by requirements.toml: disable_bypass_permissions_mode = true",
    });
  }
  // Flatten nested tables as key.path
  for (const [section, body] of Object.entries(parsed)) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      continue;
    }
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (k === "disable_bypass_permissions_mode") {
        continue;
      }
      locks.push({
        key: `${section}.${k}`,
        value: v,
        reason: `Pinned by requirements.toml [${section}] ${k}`,
      });
    }
  }
  return locks;
}

/**
 * Whether a UI control id is locked.
 * @param locks From lockedSettingsFromRequirements.
 * @param controlId e.g. always_approve.
 */
export function isControlLocked(
  locks: LockedSetting[],
  controlId: string,
): LockedSetting | null {
  return locks.find((l) => l.key === controlId || l.key.endsWith(`.${controlId}`)) ?? null;
}
