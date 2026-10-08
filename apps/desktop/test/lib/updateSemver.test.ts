/**
 * Semver subset used by the update check: ordering, v-prefix, prerelease.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalSemver,
  compareSemver,
  isNewerVersion,
  parseSemver,
} from "@/lib/updateSemver";

describe("parseSemver", () => {
  it("accepts a release, a v prefix, and build metadata", () => {
    assert.deepEqual(parseSemver("1.2.3"), {
      major: 1,
      minor: 2,
      patch: 3,
      pre: [],
    });
    assert.deepEqual(parseSemver("  v1.2.3+build.7 "), {
      major: 1,
      minor: 2,
      patch: 3,
      pre: [],
    });
    assert.deepEqual(parseSemver("1.2.3-beta.11"), {
      major: 1,
      minor: 2,
      patch: 3,
      pre: ["beta", "11"],
    });
  });

  it("rejects incomplete, prefixed-zero, and empty prerelease identifiers", () => {
    assert.equal(parseSemver(""), null);
    assert.equal(parseSemver("1.2"), null);
    assert.equal(parseSemver("01.2.3"), null);
    assert.equal(parseSemver("1.02.3"), null);
    assert.equal(parseSemver("1.2.3-"), null);
    assert.equal(parseSemver("1.2.3-01"), null);
    assert.equal(parseSemver("1.2.3-beta."), null);
    assert.equal(parseSemver("not-a-version"), null);
  });
});

describe("canonicalSemver", () => {
  it("strips v and build metadata so dismiss keys match", () => {
    assert.equal(canonicalSemver("v0.2.1"), "0.2.1");
    assert.equal(canonicalSemver("0.2.1+sha"), "0.2.1");
    assert.equal(canonicalSemver("v1.0.0-rc.1+exp"), "1.0.0-rc.1");
    assert.equal(canonicalSemver("nope"), null);
  });
});

describe("compareSemver", () => {
  it("orders releases, prereleases, and numeric identifiers", () => {
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
    assert.equal(compareSemver("v1.0.0", "1.0.0"), 0);
    assert.equal(compareSemver("1.0.0+a", "1.0.0+b"), 0);
    assert.equal(compareSemver("1.0.0", "1.0.1"), -1);
    assert.equal(compareSemver("1.1.0", "1.0.9"), 1);
    assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
    assert.equal(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);
    assert.equal(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
    assert.equal(compareSemver("1.0.0-alpha.beta", "1.0.0-beta"), -1);
    assert.equal(compareSemver("1.0.0-beta", "1.0.0-beta.2"), -1);
    assert.equal(compareSemver("1.0.0-beta.2", "1.0.0-beta.11"), -1);
    assert.equal(compareSemver("1.0.0-beta.11", "1.0.0-rc.1"), -1);
    assert.equal(compareSemver("1.0.0-rc.1", "1.0.0"), -1);
    assert.equal(compareSemver("0.2.1", "0.2.0"), 1);
  });

  it("returns null when either side is not semver", () => {
    assert.equal(compareSemver("1.0", "1.0.0"), null);
    assert.equal(compareSemver("1.0.0", ""), null);
  });
});

describe("isNewerVersion", () => {
  it("is true only for a strictly newer parseable release", () => {
    assert.equal(isNewerVersion("0.3.0", "0.2.1"), true);
    assert.equal(isNewerVersion("v0.3.0", "0.2.1"), true);
    assert.equal(isNewerVersion("0.2.1", "0.2.1"), false);
    assert.equal(isNewerVersion("0.2.0", "0.2.1"), false);
    assert.equal(isNewerVersion("0.2.1", "not-a-version"), false);
    assert.equal(isNewerVersion("1.0.0", "1.0.0-rc.1"), true);
  });
});
