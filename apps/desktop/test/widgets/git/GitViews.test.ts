/**
 * Stateless git chrome: branch chip, action bar gates / notices, PR blocker
 * text, and the git change list's attribution chips / empty states.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { gitActionGates, gitChipModel } from "@/lib/gitPanelModel";
import type { GitDiffFile, GitStatus } from "@/lib/gitTypes";
import { GitActionBarView, GitBranchChipView, prBlocker } from "@/widgets/git";
import { GitChangeListView } from "@/widgets/preview/GitChangeListView";

const STATUS: GitStatus = {
  isRepo: true,
  root: "/repo",
  branch: "feat",
  detached: false,
  head: "abc1234def",
  initial: false,
  upstream: "",
  ahead: 0,
  behind: 0,
  files: [{ path: "a.ts", index: ".", worktree: "M", kind: "modified" }],
  truncated: false,
};

describe("GitBranchChipView", () => {
  it("renders branch + dirty count, nothing outside a repo", () => {
    const html = renderToStaticMarkup(createElement(GitBranchChipView, { chip: gitChipModel(STATUS), onOpen: () => undefined }));
    assert.match(html, />feat</);
    assert.match(html, /git-chip-dirty[^>]*>1</);
    assert.equal(renderToStaticMarkup(createElement(GitBranchChipView, { chip: gitChipModel(null), onOpen: () => undefined })), "");
  });
});

describe("GitActionBarView", () => {
  it("labels Publish for unpublished branches and disables PR with a reason", () => {
    const html = renderToStaticMarkup(
      createElement(GitActionBarView, {
        status: STATUS,
        loading: false,
        error: null,
        gates: gitActionGates(STATUS, { connected: true, busy: false }),
        busy: null,
        notice: { tone: "error", text: "remote: denied" },
        onCommit: () => undefined,
        onPush: () => undefined,
        onPr: () => undefined,
        onRefresh: () => undefined,
        onDismissNotice: () => undefined,
      }),
    );
    assert.match(html, /Publish/);
    assert.match(html, /title="Publish the branch before opening a pull request"[^>]*disabled|disabled[^>]*title="Publish the branch before opening a pull request"/);
    assert.match(html, /git-notice-error/);
    assert.match(html, /remote: denied/);
  });
});

describe("prBlocker", () => {
  it("explains missing / logged-out gh and load errors", () => {
    const base = { ghAvailable: true, ghAuthenticated: true, ghMessage: "", branch: "f", upstream: "origin/f", ahead: 0, defaultBase: "main", bases: [] };
    assert.equal(prBlocker(base, ""), "");
    assert.equal(prBlocker(null, ""), "");
    assert.equal(prBlocker(null, "boom"), "boom");
    assert.match(prBlocker({ ...base, ghAvailable: false, ghMessage: "GitHub CLI (gh) is not installed" }, ""), /not installed/);
    assert.match(prBlocker({ ...base, ghAuthenticated: false }, ""), /gh auth login/);
  });
});

describe("GitChangeListView", () => {
  const file: GitDiffFile = { path: "src/a.ts", status: "modified", untracked: false, added: 3, removed: 1, binary: false, patch: "", tooLarge: false, omitted: false };
  const props = {
    actionBar: null,
    files: [file],
    totalFiles: 2,
    mode: "head" as const,
    base: "HEAD",
    loading: false,
    error: "",
    truncated: false,
    turnFilter: { index: 2, active: true },
    attribution: new Map([["src/a.ts", [{ turnId: "t2", index: 2 }]]]),
    displayFor: (f: GitDiffFile) => ({ full: `/repo/${f.path}`, dir: "src", base: "a.ts", label: f.path, inWorkspace: true }),
    collapsed: new Set<string>(),
    allCollapsed: false,
    viewPrefs: { wrap: false, dualGutter: false, preferFullFile: false } as never,
    chromeRef: null,
    summaryH: 40,
    onToggle: () => undefined,
    onCollapseAll: () => undefined,
    onExpandAll: () => undefined,
    onPrefsPatch: () => undefined,
    onModeChange: () => undefined,
    onFilterChange: () => undefined,
    renderBody: () => createElement("div", { className: "body-marker" }),
  };

  it("shows filtered counts, attribution chips and file bodies", () => {
    const html = renderToStaticMarkup(createElement(GitChangeListView, props));
    assert.match(html, /1 of 2 files vs HEAD/);
    assert.match(html, /git-turn-chip[^>]*>T2</);
    assert.match(html, /body-marker/);
  });

  it("explains an empty filtered list", () => {
    const html = renderToStaticMarkup(createElement(GitChangeListView, { ...props, files: [] }));
    assert.match(html, /None of this turn/);
  });
});
