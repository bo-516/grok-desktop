/**
 * Sandbox profile metadata for UI (F-SBX-01~06).
 * Profiles map to SPAWN `--sandbox <PROFILE>`; mid-session change requires restart (J-06).
 */

export type SandboxProfileId =
  | "off"
  | "workspace"
  | "devbox"
  | "read-only"
  | "strict";

export type SandboxProfileInfo = {
  id: SandboxProfileId;
  label: string;
  /** Short boundary description for the picker. */
  summary: string;
  /** Whether network restriction is advertised; platform may no-op. */
  claimsNetworkRestrict: boolean;
};

/** Built-in profiles from upstream docs. */
export const SANDBOX_PROFILES: SandboxProfileInfo[] = [
  {
    id: "off",
    label: "Off",
    summary: "No sandbox — full host filesystem and network.",
    claimsNetworkRestrict: false,
  },
  {
    id: "workspace",
    label: "Workspace",
    summary: "Read/write limited to session cwd; network allowed.",
    claimsNetworkRestrict: false,
  },
  {
    id: "devbox",
    label: "Devbox",
    summary: "Developer profile with broader tool access inside the box.",
    claimsNetworkRestrict: false,
  },
  {
    id: "read-only",
    label: "Read-only",
    summary: "Filesystem writes blocked; useful for review sessions.",
    claimsNetworkRestrict: false,
  },
  {
    id: "strict",
    label: "Strict",
    summary: "Tight FS + network claims. Network limit is Linux-only.",
    claimsNetworkRestrict: true,
  },
];

/**
 * Platform honesty note for sandbox network claims (F-SBX-05 / TC-SBX-03).
 * @param platform process.platform style string.
 * @param profile Selected profile.
 * @returns User-visible warning, or null when no false-security risk.
 */
export function sandboxNetworkHonestyNote(
  platform: string,
  profile: SandboxProfileId,
): string | null {
  const info = SANDBOX_PROFILES.find((p) => p.id === profile);
  if (!info?.claimsNetworkRestrict) {
    return null;
  }
  if (platform === "linux") {
    return null;
  }
  return (
    "Network restrictions for this sandbox profile are only enforced on Linux. " +
    "On macOS they are a no-op — do not assume outbound network is blocked."
  );
}

/**
 * Whether changing sandbox mid-session requires process restart (always true for SPAWN).
 * @returns Always true; UI must show restart notice (J-06).
 */
export function sandboxChangeRequiresRestart(): boolean {
  return true;
}

/**
 * Validate profile id from UI.
 * @param raw User selection.
 * @returns Known id or null.
 */
export function parseSandboxProfile(raw: string): SandboxProfileId | null {
  const hit = SANDBOX_PROFILES.find((p) => p.id === raw);
  return hit?.id ?? null;
}
