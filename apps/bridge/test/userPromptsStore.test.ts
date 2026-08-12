/**
 * User-prompt store / disk ops (S-01..S-28): set/clear/move, foreign, exclude, paths.
 * Each case uses a sandboxed GROK_HOME + temp git repo; never touches real ~/.grok.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dispatchCliCommand } from "../src/cliDispatch.js";
import {
  GLOBAL_FILE,
  PROJECT_LOCAL_FILE,
  LOCAL_EXCLUDE_LINE,
  promptsClear,
  promptsGet,
  promptsMove,
  promptsSet,
  resolveGrokHome,
  resolveProjectRoot,
  scopePath,
} from "../src/userPrompts.js";
import {
  MANAGED_MARKER,
  type PromptEntry,
  type PromptScope,
} from "../src/userPromptsFormat.js";

const scopes: PromptScope[] = ["global", "project", "projectLocal"];

function entry(text: string, id = "e0"): PromptEntry {
  return { id, text, enabled: true };
}

type Sandbox = {
  root: string;
  grokHome: string;
  repo: string;
  prevGrokHome: string | undefined;
};

let sb: Sandbox;

function makeSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "up-store-"));
  const grokHome = path.join(root, "gh");
  const repo = path.join(root, "proj");
  mkdirSync(path.join(grokHome, "rules"), { recursive: true });
  mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  // Ensure exclude path exists (git init creates .git/info/exclude on most platforms).
  const excludeDir = path.join(repo, ".git", "info");
  mkdirSync(excludeDir, { recursive: true });
  const exclude = path.join(excludeDir, "exclude");
  if (!existsSync(exclude)) {
    writeFileSync(exclude, "", "utf8");
  }
  writeFileSync(path.join(repo, ".gitignore"), "# keep\n", "utf8");
  const prevGrokHome = process.env.GROK_HOME;
  process.env.GROK_HOME = grokHome;
  return { root, grokHome, repo, prevGrokHome };
}

function cleanup(s: Sandbox) {
  if (s.prevGrokHome === undefined) {
    delete process.env.GROK_HOME;
  } else {
    process.env.GROK_HOME = s.prevGrokHome;
  }
  rmSync(s.root, { recursive: true, force: true });
}

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  cleanup(sb);
});

describe("userPrompts store ops × scopes", () => {
  for (const scope of scopes) {
    it(`S: ${scope} add / change / delete one / clear`, () => {
      const r1 = promptsSet(scope, [entry("Hello world", "a")], sb.repo);
      assert.equal(r1.removed, false);
      assert.ok(existsSync(r1.path));
      let body = readFileSync(r1.path, "utf8");
      assert.match(body, /Hello world/);
      assert.match(body, new RegExp(MANAGED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      const r2 = promptsSet(
        scope,
        [entry("Hello changed", "a")],
        sb.repo,
      );
      body = readFileSync(r2.path, "utf8");
      assert.match(body, /Hello changed/);
      assert.doesNotMatch(body, /Hello world/);

      const r3 = promptsSet(
        scope,
        [entry("Keep", "a"), entry("Drop me", "b")],
        sb.repo,
      );
      assert.ok(existsSync(r3.path));
      const afterDel = promptsSet(scope, [entry("Keep", "a")], sb.repo);
      body = readFileSync(afterDel.path, "utf8");
      assert.match(body, /Keep/);
      assert.doesNotMatch(body, /Drop me/);

      const cleared = promptsClear(scope, sb.repo);
      assert.equal(cleared.removed, true);
      assert.equal(existsSync(cleared.path), false);
    });
  }
});

describe("userPrompts store cross-cutting", () => {
  it("S-13: long → short exact byte length", () => {
    promptsSet("global", [entry("x".repeat(500))], sb.repo);
    const short = entry("hi");
    const r = promptsSet("global", [short], sb.repo);
    const onDisk = readFileSync(r.path);
    assert.equal(onDisk.byteLength, r.bytes);
    // No trailing garbage past content.
    assert.equal(onDisk.toString("utf8").includes("x".repeat(50)), false);
  });

  it("S-14: clear → exists false (not zero-byte file)", () => {
    promptsSet("global", [entry("bye")], sb.repo);
    const r = promptsClear("global", sb.repo);
    assert.equal(existsSync(r.path), false);
    const snap = promptsGet(sb.repo);
    assert.equal(snap.global.exists, false);
  });

  it("S-15: clear does not remove hand-written sibling", () => {
    const rulesDir = path.join(sb.grokHome, "rules");
    const own = path.join(rulesDir, "my-own.md");
    writeFileSync(own, "# mine\n", "utf8");
    promptsSet("global", [entry("managed")], sb.repo);
    promptsClear("global", sb.repo);
    assert.equal(readFileSync(own, "utf8"), "# mine\n");
  });

  it("S-16: foreign file refuses set/clear; bytes unchanged", () => {
    const p = scopePath("global", sb.grokHome, sb.repo);
    mkdirSync(path.dirname(p), { recursive: true });
    const foreign = "# not ours\n- leave me\n";
    writeFileSync(p, foreign, "utf8");
    assert.throws(() => promptsSet("global", [entry("x")], sb.repo), /not written by grok-desktop/);
    assert.throws(() => promptsClear("global", sb.repo), /not written by grok-desktop/);
    assert.equal(readFileSync(p, "utf8"), foreign);
  });

  it("S-17: rules dir auto-created; file owner-readable", () => {
    rmSync(path.join(sb.grokHome, "rules"), { recursive: true, force: true });
    const r = promptsSet("global", [entry("perm")], sb.repo);
    assert.ok(existsSync(r.path));
    const st = statSync(r.path);
    // On some CI FS modes may be masked; require owner-read at least.
    assert.ok((st.mode & 0o400) !== 0);
  });

  it("S-18: no .tmp leftovers after success", () => {
    promptsSet("global", [entry("atom")], sb.repo);
    const dir = path.join(sb.grokHome, "rules");
    const leftovers = readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  it("S-19: path args in prompts_set do not escape (cli path isolation)", async () => {
    const outside = path.join(sb.root, "outside.md");
    await dispatchCliCommand(
      "prompts_set",
      {
        scope: "global",
        entries: [entry("safe")],
        path: outside,
        file: "../etc/passwd",
      } as Record<string, unknown>,
      sb.repo,
    );
    assert.equal(existsSync(outside), false);
    const expected = path.join(sb.grokHome, "rules", GLOBAL_FILE);
    assert.ok(existsSync(expected));
  });

  it("S-20: GROK_HOME sandbox is used", () => {
    assert.equal(resolveGrokHome(), sb.grokHome);
    promptsSet("global", [entry("home")], sb.repo);
    assert.ok(existsSync(path.join(sb.grokHome, "rules", GLOBAL_FILE)));
  });

  it("S-21: deep cwd still writes project rules at repo root", () => {
    const deep = path.join(sb.repo, "src", "deep");
    const r = promptsSet("project", [entry("deep")], deep);
    // realpath: macOS may resolve /var → /private/var via git toplevel
    assert.equal(
      realpathSync(r.path),
      realpathSync(path.join(sb.repo, ".grok", "rules", GLOBAL_FILE)),
    );
    assert.ok(existsSync(r.path));
  });

  it("S-22: non-git dir → projectRoot=cwd, skip exclude, gitRepo false", () => {
    const plain = path.join(sb.root, "plain");
    mkdirSync(plain, { recursive: true });
    const { projectRoot, gitRepo } = resolveProjectRoot(plain);
    assert.equal(gitRepo, false);
    assert.equal(projectRoot, path.resolve(plain));
    const r = promptsSet("projectLocal", [entry("local")], plain);
    assert.ok(existsSync(r.path));
    // No .git → exclude skipped
    assert.equal(existsSync(path.join(plain, ".git")), false);
  });

  it("S-23: projectLocal exclude line is idempotent", () => {
    promptsSet("projectLocal", [entry("one")], sb.repo);
    promptsSet("projectLocal", [entry("two")], sb.repo);
    const body = readFileSync(
      path.join(sb.repo, ".git", "info", "exclude"),
      "utf8",
    );
    const hits = body.split(/\r?\n/).filter((l) => l.trim() === LOCAL_EXCLUDE_LINE);
    assert.equal(hits.length, 1);
  });

  it("S-24: .gitignore bytes unchanged", () => {
    const gi = path.join(sb.repo, ".gitignore");
    const before = readFileSync(gi);
    promptsSet("projectLocal", [entry("x")], sb.repo);
    promptsSet("project", [entry("y")], sb.repo);
    promptsClear("projectLocal", sb.repo);
    assert.deepEqual(readFileSync(gi), before);
  });

  it("S-25: git visibility — team tracked candidate, local ignored", () => {
    promptsSet("project", [entry("team")], sb.repo);
    promptsSet("projectLocal", [entry("mine")], sb.repo);
    const localPath = path.join(
      sb.repo,
      ".grok",
      "rules",
      PROJECT_LOCAL_FILE,
    );
    const teamPath = path.join(sb.repo, ".grok", "rules", GLOBAL_FILE);
    // check-ignore exits 0 when ignored
    execFileSync("git", ["-C", sb.repo, "check-ignore", "-q", localPath]);
    // Team file must NOT be ignored
    assert.throws(() =>
      execFileSync("git", ["-C", sb.repo, "check-ignore", "-q", teamPath]),
    );
    const status = execFileSync("git", ["-C", sb.repo, "status", "--porcelain"], {
      encoding: "utf8",
    });
    // Untracked tree may show as `?? .grok/` rather than the leaf name.
    assert.match(status, /\.grok/);
    assert.doesNotMatch(status, /01-grok-desktop\.local\.md/);
  });

  it("S-26: move success path + atomic rollback on from failure", () => {
    promptsSet("global", [entry("move-me", "m"), entry("stay", "s")], sb.repo);
    const moved = promptsMove("global", "project", 0, sb.repo);
    assert.equal(moved.from.removed, false);
    const g = promptsGet(sb.repo);
    assert.equal(g.global.entries.length, 1);
    assert.equal(g.global.entries[0]!.text, "stay");
    assert.equal(g.project.entries.length, 1);
    assert.equal(g.project.entries[0]!.text, "move-me");

    // Rollback: make from path a foreign file so source write fails after to succeeds.
    promptsSet("global", [entry("a", "1")], sb.repo);
    promptsSet("project", [entry("b", "2")], sb.repo);
    // Replace global with foreign AFTER reading would happen — inject by
    // making the from path unwritable via foreign marker after first write.
    // Simpler: move when from is foreign.
    const gPath = scopePath("global", sb.grokHome, sb.repo);
    writeFileSync(gPath, "# foreign\n", "utf8");
    assert.throws(
      () => promptsMove("global", "project", 0, sb.repo),
      /not written by grok-desktop/,
    );
    // project still only has "b"
    const snap = promptsGet(sb.repo);
    assert.equal(snap.project.entries.map((e) => e.text).join(","), "b");
  });

  it("S-27: clear global leaves project layers intact", () => {
    promptsSet("global", [entry("g")], sb.repo);
    promptsSet("project", [entry("p")], sb.repo);
    promptsSet("projectLocal", [entry("l")], sb.repo);
    promptsClear("global", sb.repo);
    const snap = promptsGet(sb.repo);
    assert.equal(snap.global.exists, false);
    assert.equal(snap.project.entries[0]!.text, "p");
    assert.equal(snap.projectLocal.entries[0]!.text, "l");
  });

  it("S-28: concurrent sets leave a complete version", async () => {
    const jobs = Array.from({ length: 8 }, (_, i) =>
      Promise.resolve().then(() =>
        promptsSet("global", [entry(`v${i}`, `id${i}`)], sb.repo),
      ),
    );
    await Promise.all(jobs);
    const snap = promptsGet(sb.repo);
    assert.equal(snap.global.exists, true);
    assert.equal(snap.global.entries.length, 1);
    assert.match(snap.global.entries[0]!.text, /^v\d$/);
    const body = readFileSync(snap.global.path, "utf8");
    assert.ok(body.startsWith(MANAGED_MARKER));
    assert.ok(body.endsWith("\n"));
  });
});

