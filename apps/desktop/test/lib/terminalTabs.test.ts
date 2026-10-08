/**
 * Terminal dock tab model: create / patch / close, labels, exit text.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveBridgeTerminal } from "@/bridge/liveBridgeTerminalTypes";
import {
  closeTerminalTab,
  createTerminalTab,
  patchTerminalTab,
  pathBasename,
  shellProgramName,
  terminalExitBanner,
  terminalExitDetail,
  terminalTabLabel,
} from "@/lib/terminalTabs";

/** Unused channel stub: the model never calls it. */
const api = {} as LiveBridgeTerminal;

describe("terminalTabs", () => {
  it("creates a starting tab bound to the viewing session", () => {
    const tab = createTerminalTab("tab-1", api, "s1", "/w/app");
    assert.equal(tab.status, "starting");
    assert.equal(tab.sessionId, "s1");
    assert.equal(tab.requestedCwd, "/w/app");
    const draft = createTerminalTab("tab-2", api, null, "");
    assert.equal(draft.sessionId, undefined);
    assert.equal(draft.requestedCwd, undefined);
  });

  it("patches by key and ignores unknown keys", () => {
    const tabs = [createTerminalTab("a", api, null, ""), createTerminalTab("b", api, null, "")];
    const next = patchTerminalTab(tabs, "b", { status: "running", terminalId: "pty-2" });
    assert.equal(next[1].terminalId, "pty-2");
    assert.equal(next[0], tabs[0]);
    assert.equal(patchTerminalTab(tabs, "zzz", { title: "x" }), tabs);
  });

  it("closing the active tab selects the right neighbour, else the left", () => {
    const tabs = ["a", "b", "c"].map((k) => createTerminalTab(k, api, null, ""));
    assert.equal(closeTerminalTab(tabs, "b", "b").activeKey, "c");
    assert.equal(closeTerminalTab(tabs, "c", "c").activeKey, "b");
    assert.equal(closeTerminalTab(tabs, "a", "c").activeKey, "a");
    const last = closeTerminalTab([tabs[0]], "a", "a");
    assert.deepEqual(last, { tabs: [], activeKey: null });
    assert.equal(closeTerminalTab(tabs, "a", "nope").tabs, tabs);
  });

  it("labels prefer the shell title, then shell · folder", () => {
    const tab = createTerminalTab("a", api, null, "");
    assert.equal(terminalTabLabel(tab), "Terminal");
    const running = {
      ...tab,
      info: { terminalId: "pty-1", cwd: "/Users/me/grok-desktop", shell: "/bin/zsh", pid: 1, cols: 80, rows: 24 },
    };
    assert.equal(terminalTabLabel(running), "zsh · grok-desktop");
    assert.equal(terminalTabLabel({ ...running, title: "  vim main.go " }), "vim main.go");
    assert.equal(terminalTabLabel({ ...tab, status: "failed" }), "Terminal (failed)");
    assert.equal(shellProgramName("C:\\Program Files\\PowerShell\\7\\pwsh.EXE"), "pwsh");
    assert.equal(pathBasename("C:\\work\\repo\\"), "repo");
  });

  it("describes exits for the tooltip and the in-terminal banner", () => {
    assert.equal(terminalExitDetail({ reason: "exited", exitCode: 0 }), "Process exited with code 0");
    assert.equal(terminalExitDetail({ reason: "killed", exitCode: -1 }), "Terminated");
    assert.equal(
      terminalExitDetail({ reason: "disconnected", exitCode: null, message: "Bridge disconnected" }),
      "Disconnected: Bridge disconnected",
    );
    assert.equal(terminalExitDetail({ reason: "error", exitCode: null }), "Error");
    assert.match(terminalExitBanner({ reason: "exited", exitCode: 2 }), /^\r\n\u001b\[2m\[Process exited with code 2\]\u001b\[0m\r\n$/);
  });
});
