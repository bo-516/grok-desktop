/**
 * Path display contract: shortening is presentation-only and must never lose
 * the real absolute path (copy / preview reads depend on it).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactPathLabel,
  homePrefixFrom,
  relativizePath,
  relativizeTitlePaths,
  splitTitlePath,
  stripFileUri,
  toPathDisplay,
} from "@/lib/pathDisplay";

const ws = "/Users/me/Desktop/idea/grok-desktop";

describe("pathDisplay", () => {
  it("strips file:// and percent-encoding", () => {
    assert.equal(stripFileUri("file:///Users/me/a%20b.ts"), "/Users/me/a b.ts");
    assert.equal(stripFileUri("/Users/me/a.ts"), "/Users/me/a.ts");
    // Broken escape must not throw during render.
    assert.equal(stripFileUri("file:///Users/me/%E0.ts"), "/Users/me/%E0.ts");
  });

  it("infers the home prefix from the workspace only", () => {
    assert.equal(homePrefixFrom(ws), "/Users/me");
    assert.equal(homePrefixFrom("/home/me/src/app"), "/home/me");
    assert.equal(homePrefixFrom("C:\\Users\\me\\src"), "C:/Users/me");
    assert.equal(homePrefixFrom(""), "");
    assert.equal(homePrefixFrom("/opt/build"), "");
  });

  it("relativizes inside the workspace, falls back to ~, then absolute", () => {
    assert.deepEqual(relativizePath(`${ws}/src/App.tsx`, ws), {
      text: "src/App.tsx",
      inWorkspace: true,
    });
    assert.deepEqual(relativizePath("/Users/me/code/x/prompt.js", ws), {
      text: "~/code/x/prompt.js",
      inWorkspace: false,
    });
    assert.deepEqual(relativizePath("/opt/tools/run.sh", ws), {
      text: "/opt/tools/run.sh",
      inWorkspace: false,
    });
    // A sibling directory that merely shares a prefix is not "inside".
    assert.deepEqual(relativizePath(`${ws}-old/src/App.tsx`, ws), {
      text: "~/Desktop/idea/grok-desktop-old/src/App.tsx",
      inWorkspace: false,
    });
    // No workspace: nothing is guessed, not even ~.
    assert.deepEqual(relativizePath("/Users/me/code/x.js", ""), {
      text: "/Users/me/code/x.js",
      inWorkspace: false,
    });
    // The workspace root itself renders as its folder name, never empty.
    assert.equal(relativizePath(ws, ws).text, "grok-desktop");
  });

  it("splits a display into dir + base and keeps the absolute path", () => {
    const display = toPathDisplay(`file://${ws}/src/widgets/App.tsx`, ws);
    assert.equal(display.full, `${ws}/src/widgets/App.tsx`);
    assert.equal(display.dir, "src/widgets");
    assert.equal(display.base, "App.tsx");
    assert.equal(display.label, "src/widgets/App.tsx");
    assert.equal(display.inWorkspace, true);
    const outside = toPathDisplay("/opt/a.sh", ws);
    assert.equal(outside.dir, "/opt");
    assert.equal(outside.base, "a.sh");
    const bare = toPathDisplay("a.sh", ws);
    assert.equal(bare.dir, "");
    assert.equal(bare.base, "a.sh");
  });

  it("compacts long labels from the middle, keeping head and file name", () => {
    const long = "~/Desktop/code/mira/novel/plugins/ai-inspector/src/server/prompt.js";
    const compact = compactPathLabel(long, 44);
    assert.ok(compact.length <= 44, compact);
    assert.ok(compact.startsWith("~/…/"), compact);
    assert.ok(compact.endsWith("/prompt.js"), compact);
    // Short enough, or too few segments to drop: untouched.
    assert.equal(compactPathLabel("src/App.tsx", 44), "src/App.tsx");
    assert.equal(compactPathLabel("/very-long-single-name-file.ts", 10), "/very-long-single-name-file.ts");
  });

  it("splits a title around its first path so the file name can be pinned", () => {
    const split = splitTitlePath(`Edit \`${ws}/src/App.tsx\``);
    assert.deepEqual(split, {
      before: "Edit `",
      path: `${ws}/src/App.tsx`,
      after: "`",
    });
    // Repeated calls must not drift: the shared token regex is /g.
    assert.deepEqual(splitTitlePath(`Edit \`${ws}/src/App.tsx\``), split);
    assert.equal(splitTitlePath("Search tools: \"browser screenshot\""), null);
    assert.equal(splitTitlePath(""), null);
    const shell = splitTitlePath("Execute `ls -la /opt/app` twice");
    assert.equal(shell?.path, "/opt/app");
    assert.equal(shell?.before, "Execute `ls -la ");
    assert.equal(shell?.after, "` twice");
  });

  it("rewrites path tokens inside tool titles and leaves prose/URLs alone", () => {
    assert.equal(
      relativizeTitlePaths(`Edit \`${ws}/src/App.tsx\``, ws),
      "Edit `src/App.tsx`",
    );
    assert.equal(
      relativizeTitlePaths("Read /Users/me/notes/todo.md", ws),
      "Read ~/notes/todo.md",
    );
    assert.equal(
      relativizeTitlePaths("Fetch https://example.com/docs/a", ws),
      "Fetch https://example.com/docs/a",
    );
    assert.equal(relativizeTitlePaths("Bash · ls / -la", ws), "Bash · ls / -la");
    assert.equal(relativizeTitlePaths("read and/or write", ws), "read and/or write");
    assert.equal(relativizeTitlePaths("", ws), "");
  });
});
