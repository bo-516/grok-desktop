/**
 * Semver compare for the in-app update check.
 *
 * Accepts the subset GitHub release tags use: optional leading "v",
 * major.minor.patch, optional prerelease, ignored build metadata.
 * Numeric identifiers compare by value (beta.2 < beta.11). A release is
 * greater than a prerelease of the same triple (1.0.0 > 1.0.0-rc.1).
 * Leading zeros on numeric parts are rejected so "01.0.0" cannot sort
 * above "1.0.0". Unparseable input returns null; callers must not treat
 * that as equal.
 */

/** One parsed semver. `pre` is empty for a release. */
export type Semver = {
  /** Major component. Non-negative, no leading zeros. */
  major: number;
  /** Minor component. Non-negative, no leading zeros. */
  minor: number;
  /** Patch component. Non-negative, no leading zeros. */
  patch: number;
  /**
   * Prerelease identifiers in order. Empty means a release.
   * Numeric identifiers are decimal strings without leading zeros.
   */
  pre: string[];
};

/** One numeric component: 0 or a non-zero digit followed by digits. */
const NUM = "0|[1-9]\\d*";

/**
 * Full tag pattern. Build metadata after "+" is captured only so it is
 * ignored. Prerelease is the group after "-".
 */
const SEMVER_RE = new RegExp(
  `^v?(${NUM})\\.(${NUM})\\.(${NUM})(?:-([0-9A-Za-z.-]+))?(?:\\+[0-9A-Za-z.-]+)?$`,
);

/**
 * True when a prerelease identifier is legal.
 * Numeric identifiers must not have leading zeros (semver spec).
 * @param id One dot-separated prerelease identifier.
 * @returns false for an empty string or a leading-zero number.
 */
function validPreIdent(id: string): boolean {
  if (id.length === 0) {
    return false;
  }
  if (/^\d+$/.test(id)) {
    return id === "0" || !id.startsWith("0");
  }
  return /^[0-9A-Za-z-]+$/.test(id);
}

/**
 * Parse a version tag into components.
 * @param raw Tag or semver, possibly with a leading v and surrounding space.
 * @returns The parsed value, or null when the string is not this subset.
 */
export function parseSemver(raw: string): Semver | null {
  const match = SEMVER_RE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const preRaw = match[4];
  const pre = preRaw ? preRaw.split(".") : [];
  for (const id of pre) {
    if (!validPreIdent(id)) {
      return null;
    }
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return { major, minor, patch, pre };
}

/**
 * Canonical form used for dismiss matching. "v0.2.1" and "0.2.1" become
 * "0.2.1". Build metadata is dropped. Prerelease is kept.
 * @param raw Tag or semver.
 * @returns Canonical string, or null when parseSemver rejects the input.
 */
export function canonicalSemver(raw: string): string | null {
  const parsed = parseSemver(raw);
  if (!parsed) {
    return null;
  }
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.pre.length === 0) {
    return core;
  }
  return `${core}-${parsed.pre.join(".")}`;
}

/**
 * Compare two numeric prerelease identifiers that have no leading zeros.
 * Longer digit strings are larger (11 > 2). Equal length compares lexically,
 * which matches numeric order.
 * @param a Left numeric identifier.
 * @param b Right numeric identifier.
 * @returns -1, 0, or 1.
 */
function compareNumericIdent(a: string, b: string): -1 | 0 | 1 {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Compare one prerelease identifier per semver: numbers rank below text,
 * numbers compare numerically, text compares by ASCII.
 * @param a Left identifier.
 * @param b Right identifier.
 * @returns -1, 0, or 1.
 */
function compareIdent(a: string, b: string): -1 | 0 | 1 {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    return compareNumericIdent(a, b);
  }
  if (aNum) {
    return -1;
  }
  if (bNum) {
    return 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Compare two already-parsed versions.
 * A release (empty pre) is greater than any prerelease of the same triple.
 * A shorter prerelease list is smaller when the shared prefix matches
 * (1.0.0-alpha < 1.0.0-alpha.1).
 * @param left Parsed left side.
 * @param right Parsed right side.
 * @returns -1 when left < right, 0 when equal, 1 when left > right.
 */
function compareParsed(left: Semver, right: Semver): -1 | 0 | 1 {
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) {
    return 0;
  }
  if (left.pre.length === 0) {
    return 1;
  }
  if (right.pre.length === 0) {
    return -1;
  }
  const count = Math.max(left.pre.length, right.pre.length);
  let index = 0;
  while (index < count) {
    const li = left.pre[index];
    const ri = right.pre[index];
    if (li === undefined) {
      return -1;
    }
    if (ri === undefined) {
      return 1;
    }
    const cmp = compareIdent(li, ri);
    if (cmp !== 0) {
      return cmp;
    }
    index += 1;
  }
  return 0;
}

/**
 * Compare two version strings.
 * @param left Left tag or semver.
 * @param right Right tag or semver.
 * @returns -1, 0, 1, or null when either side does not parse.
 */
export function compareSemver(left: string, right: string): -1 | 0 | 1 | null {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    return null;
  }
  return compareParsed(a, b);
}

/**
 * True when `latest` is a strictly newer semver than `current`.
 * Unparseable input returns false so a bad tag never looks like an update.
 * @param latest Candidate release version.
 * @param current Version the running app was built as.
 * @returns true only when both parse and latest > current.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) === 1;
}
