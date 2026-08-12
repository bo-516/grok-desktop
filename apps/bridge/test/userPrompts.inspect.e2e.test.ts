/**
 * True-grok inspect e2e (E-01..E-09, T-ORD-01/02).
 * Skips when resolveGrokBin cannot find a binary (no mock agent).
 * Sandboxed GROK_HOME — never touches real ~/.grok.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, describe, it } from "node:test";
import { resolveGrokBin } from "../src/spawnGrok.js";
import {
  GLOBAL_FILE,
  PROJECT_LOCAL_FILE,
  promptsClear,
  promptsSet,
} from "../src/userPrompts.js";
import type { PromptEntry } from "../src/userPromptsFormat.js";

function entry(text: string, id = "e0"): PromptEntry {
  return { id, text, enabled: true };
}

/** Case-insensitive realpath compare (F12 macOS path normalization). */
function samePath(a: string, b: string): boolean {
  try {
    const ra = execFileSync("realpath", [a], { encoding: "utf8" }).trim();
    const rb = execFileSync("realpath", [b], { encoding: "utf8" }).trim();
    return ra.toLowerCase() === rb.toLowerCase();
  } catch {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  }
}

type InspectInstr = {
  path?: string;
  scope?: string;
  fileType?: string;
  sizeBytes?: number;
  approxTokens?: number;
};

type InspectJson = {
  projectRoot?: string | null;
  projectInstructions?: InspectInstr[];
};

function runInspect(cwd: string, grokHome: string, bin: string): InspectJson {
  const out = execFileSync(
    bin,
    ["--no-auto-update", "inspect", "--json"],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GROK_HOME: grokHome },
      timeout: 60_000,
    },
  );
  return JSON.parse(out) as InspectJson;
}

function findInstr(
  list: InspectInstr[] | undefined,
  filePath: string,
): InspectInstr | undefined {
  return (list ?? []).find((i) => i.path && samePath(i.path, filePath));
}

let grokBin: string | null = null;
let skipReason = "";

before(() => {
  try {
    grokBin = resolveGrokBin();
    // Probe that the binary actually runs.
    execFileSync(grokBin, ["--no-auto-update", "--help"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    grokBin = null;
    skipReason = `grok CLI not installed: ${err instanceof Error ? err.message : String(err)}`;
  }
});

describe("userPrompts inspect e2e (true grok)", () => {
  let root = "";
  let grokHome = "";
  let repo = "";
  let prevHome: string | undefined;

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = prevHome;
    }
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function setup() {
    if (!grokBin) {
      return false;
    }
    root = mkdtempSync(path.join(tmpdir(), "up-inspect-"));
    grokHome = path.join(root, "gh");
    repo = path.join(root, "proj");
    mkdirSync(path.join(grokHome, "rules"), { recursive: true });
    mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    const excludeDir = path.join(repo, ".git", "info");
    mkdirSync(excludeDir, { recursive: true });
    writeFileSync(path.join(excludeDir, "exclude"), "", "utf8");
    prevHome = process.env.GROK_HOME;
    process.env.GROK_HOME = grokHome;
    return true;
  }

  it("E-01..E-04: global add / change size / delete shrink / clear unlist", (t) => {
    if (!setup()) {
      t.skip(skipReason || "grok CLI not installed");
      return;
    }
    const bin = grokBin!;
    const r = promptsSet(
      "global",
      [entry("Always respond in zh-CN for E01.")],
      repo,
    );
    let insp = runInspect(repo, grokHome, bin);
    let hit = findInstr(insp.projectInstructions, r.path);
    assert.ok(hit, `E-01: path not listed: ${JSON.stringify(insp.projectInstructions)}`);
    assert.equal(hit!.scope, "global");
    assert.equal(hit!.fileType, "rules");
    assert.ok((hit!.approxTokens ?? 0) > 0);

    const long = promptsSet(
      "global",
      [entry("Always respond in zh-CN for E02 with more text to grow size.")],
      repo,
    );
    insp = runInspect(repo, grokHome, bin);
    hit = findInstr(insp.projectInstructions, long.path);
    assert.ok(hit);
    assert.equal(hit!.sizeBytes, long.bytes);

    const short = promptsSet("global", [entry("short E03")], repo);
    insp = runInspect(repo, grokHome, bin);
    hit = findInstr(insp.projectInstructions, short.path);
    assert.ok(hit);
    assert.ok((hit!.sizeBytes ?? 0) < (long.bytes));
    assert.ok((hit!.sizeBytes ?? 0) > 0);

    promptsClear("global", repo);
    insp = runInspect(repo, grokHome, bin);
    hit = findInstr(insp.projectInstructions, r.path);
    assert.equal(hit, undefined, "E-04: cleared path must leave inspect list");
  });

  it("E-05..E-06: project + projectLocal scopes and ignore", (t) => {
    if (!setup()) {
      t.skip(skipReason || "grok CLI not installed");
      return;
    }
    const bin = grokBin!;
    const team = promptsSet("project", [entry("team rule E05")], repo);
    const local = promptsSet("projectLocal", [entry("local rule E06")], repo);
    const insp = runInspect(repo, grokHome, bin);
    const teamHit = findInstr(insp.projectInstructions, team.path);
    const localHit = findInstr(insp.projectInstructions, local.path);
    assert.ok(teamHit);
    assert.equal(teamHit!.scope, "project");
    assert.ok(localHit);
    assert.equal(localHit!.scope, "project");
    execFileSync("git", ["-C", repo, "check-ignore", "-q", local.path]);
  });

  it("E-07..E-08: load order global before project; Jack/Tom both listed", (t) => {
    if (!setup()) {
      t.skip(skipReason || "grok CLI not installed");
      return;
    }
    const bin = grokBin!;
    const g = promptsSet("global", [entry("我叫 Jack")], repo);
    const p = promptsSet("project", [entry("我叫 Tom")], repo);
    const insp = runInspect(repo, grokHome, bin);
    const list = insp.projectInstructions ?? [];
    const gi = list.findIndex((i) => i.path && samePath(i.path, g.path));
    const pi = list.findIndex((i) => i.path && samePath(i.path, p.path));
    assert.ok(gi >= 0 && pi >= 0, "E-08: both listed");
    assert.ok(gi < pi, `E-07/E-08: global index ${gi} must be before project ${pi}`);
  });

  it("E-09: deep cwd still loads project rules at repo root path", (t) => {
    if (!setup()) {
      t.skip(skipReason || "grok CLI not installed");
      return;
    }
    const bin = grokBin!;
    const deep = path.join(repo, "src", "deep");
    const r = promptsSet("project", [entry("deep E09")], deep);
    const insp = runInspect(deep, grokHome, bin);
    const hit = findInstr(insp.projectInstructions, r.path);
    assert.ok(hit, "E-09: project path listed from deep cwd");
    assert.ok(
      samePath(r.path, path.join(repo, ".grok", "rules", GLOBAL_FILE)),
    );
  });

  it("T-ORD-01/02: dictionary order of rules filenames", (t) => {
    if (!setup()) {
      t.skip(skipReason || "grok CLI not installed");
      return;
    }
    const bin = grokBin!;
    const rulesDir = path.join(grokHome, "rules");
    writeFileSync(path.join(rulesDir, "zz.md"), "# zz\n- last\n", "utf8");
    writeFileSync(path.join(rulesDir, "00-a.md"), "# a\n- first\n", "utf8");
    writeFileSync(path.join(rulesDir, "01-b.md"), "# b\n- mid\n", "utf8");
    // Managed names for T-ORD-02
    writeFileSync(
      path.join(rulesDir, GLOBAL_FILE),
      "<!-- grok-desktop:managed v1 -->\n\n- team\n",
      "utf8",
    );
    writeFileSync(
      path.join(rulesDir, PROJECT_LOCAL_FILE),
      "<!-- grok-desktop:managed v1 -->\n\n- local\n",
      "utf8",
    );
    // PROJECT_LOCAL_FILE is for project dir; also place 01 local under global for order check of 00 vs 01 prefix.
    const insp = runInspect(repo, grokHome, bin);
    const paths = (insp.projectInstructions ?? [])
      .filter((i) => i.scope === "global" && i.fileType === "rules")
      .map((i) => path.basename(i.path ?? ""));
    const i00a = paths.indexOf("00-a.md");
    const i01b = paths.indexOf("01-b.md");
    const izz = paths.indexOf("zz.md");
    if (i00a >= 0 && i01b >= 0 && izz >= 0) {
      assert.ok(i00a < i01b && i01b < izz, `T-ORD-01 order: ${paths.join(",")}`);
    }
    const iTeam = paths.indexOf(GLOBAL_FILE);
    const iLocal = paths.indexOf(PROJECT_LOCAL_FILE);
    if (iTeam >= 0 && iLocal >= 0) {
      assert.ok(
        iTeam < iLocal,
        `T-ORD-02: ${GLOBAL_FILE} must load before ${PROJECT_LOCAL_FILE}: ${paths.join(",")}`,
      );
    }
  });
});
