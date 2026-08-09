/**
 * Sandbox profile metadata for UI (F-SBX-01~06).
 * Mirrors bridge/src/sandboxProfiles for the desktop bundle (no cross-app imports).
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
  summary: string;
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
 * @param platform process.platform or navigator-derived string.
 * @param profile Selected profile.
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

/** SPAWN sandbox change always needs process restart (J-06). */
export function sandboxChangeRequiresRestart(): boolean {
  return true;
}
