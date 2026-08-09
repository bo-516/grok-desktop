/**
 * grok CLI version floor checks (F-OPS-01 / TC-OPS-01).
 */

/** Minimum supported CLI version (semver-ish major.minor.patch). */
export const MIN_GROK_VERSION = "0.9.0";

/**
 * Parse first `major.minor.patch` from a version string such as `grok 1.0.0 (hash)`.
 * @param raw Output of `grok --version` or `grok version`.
 * @returns Tuple or null when unparseable.
 */
export function parseSemver(
  raw: string | null | undefined,
): [number, number, number] | null {
  if (!raw) {
    return null;
  }
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two semver tuples: -1 if a<b, 0 equal, 1 if a>b.
 */
export function compareSemver(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) {
      return -1;
    }
    if (av > bv) {
      return 1;
    }
  }
  return 0;
}

/**
 * Whether the installed CLI meets the desktop minimum.
 * @param versionRaw Version string from environment probe.
 * @param min Minimum accepted version (default MIN_GROK_VERSION).
 */
export function isGrokVersionSupported(
  versionRaw: string | null | undefined,
  min: string = MIN_GROK_VERSION,
): { ok: boolean; message: string; parsed: string | null } {
  const parsed = parseSemver(versionRaw);
  const minParsed = parseSemver(min);
  if (!parsed || !minParsed) {
    return {
      ok: false,
      message: `Unable to parse grok version (${versionRaw ?? "null"}); need ≥ ${min}`,
      parsed: null,
    };
  }
  if (compareSemver(parsed, minParsed) < 0) {
    return {
      ok: false,
      message: `grok ${parsed.join(".")} is below the minimum supported version ${min}. Please upgrade the CLI.`,
      parsed: parsed.join("."),
    };
  }
  return {
    ok: true,
    message: `grok ${parsed.join(".")} ok`,
    parsed: parsed.join("."),
  };
}
