/**
 * Pure tab model for the terminal dock: create / patch / close, labels, and
 * the exit text written into a finished terminal. No React, no DOM.
 */

import type {
  LiveBridgeTerminal,
  TerminalExit,
  TerminalInfo,
} from "@/bridge/liveBridgeTerminalTypes";

/** Lifecycle of one tab as the dock shows it. */
export type TerminalTabStatus = "starting" | "running" | "exited" | "failed";

/** One terminal tab (widget state). */
export type TerminalTab = {
  /** Client key; stable from "starting" through "exited". */
  key: string;
  /**
   * Bridge channel the tab was created on. A reconnect yields a new channel;
   * old tabs keep theirs and end as `disconnected` (the bridge killed them).
   */
  api: LiveBridgeTerminal;
  /** Session bound at create time; undefined for a New chat draft. */
  sessionId?: string;
  /** Workspace root requested at create time; undefined → bridge default. */
  requestedCwd?: string;
  /** Bridge terminal id once created; null while starting / after a failed start. */
  terminalId: string | null;
  /** Bridge description once created. */
  info: TerminalInfo | null;
  /** Current lifecycle state. */
  status: TerminalTabStatus;
  /** Window title the shell set (OSC 0/2); "" until it sets one. */
  title: string;
  /** Exit / failure detail for the tab tooltip; "" while healthy. */
  detail: string;
};

/** Fields a tab update may change (identity and channel are fixed). */
export type TerminalTabPatch = Partial<Omit<TerminalTab, "key" | "api">>;

/**
 * New tab in the `starting` state.
 * @param key Unique client key.
 * @param api Channel of the live bridge handle at creation time.
 * @param sessionId Viewing session id (null / "" → unbound).
 * @param cwd Viewing session workspace ("" → bridge default).
 */
export function createTerminalTab(
  key: string,
  api: LiveBridgeTerminal,
  sessionId: string | null,
  cwd: string,
): TerminalTab {
  return {
    key,
    api,
    sessionId: sessionId || undefined,
    requestedCwd: cwd || undefined,
    terminalId: null,
    info: null,
    status: "starting",
    title: "",
    detail: "",
  };
}

/**
 * Apply a partial update to one tab.
 * @param tabs Current tabs.
 * @param key Tab to update; unknown keys leave the list unchanged.
 * @param patch Fields to overwrite.
 * @returns A new array (same order) when the tab exists, else `tabs`.
 */
export function patchTerminalTab(
  tabs: TerminalTab[],
  key: string,
  patch: TerminalTabPatch,
): TerminalTab[] {
  if (!tabs.some((t) => t.key === key)) {
    return tabs;
  }
  return tabs.map((t) => (t.key === key ? { ...t, ...patch } : t));
}

/**
 * Remove a tab and pick the next active one (right neighbour, else left).
 * @param tabs Current tabs.
 * @param activeKey Currently active key.
 * @param key Tab being closed.
 * @returns Remaining tabs and the active key (null when none remain).
 */
export function closeTerminalTab(
  tabs: TerminalTab[],
  activeKey: string | null,
  key: string,
): { tabs: TerminalTab[]; activeKey: string | null } {
  const index = tabs.findIndex((t) => t.key === key);
  if (index < 0) {
    return { tabs, activeKey };
  }
  const remaining = tabs.filter((t) => t.key !== key);
  if (activeKey !== key) {
    return { tabs: remaining, activeKey };
  }
  const next = remaining[index] ?? remaining[index - 1] ?? null;
  return { tabs: remaining, activeKey: next ? next.key : null };
}

/**
 * Last path segment for either separator.
 * @param path Absolute or relative path; "" → "".
 */
export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/**
 * Program name of a shell path (`/bin/zsh` → `zsh`, `C:\…\pwsh.exe` → `pwsh`).
 * @param shell Shell path from TerminalInfo.
 */
export function shellProgramName(shell: string): string {
  return pathBasename(shell).replace(/\.exe$/i, "");
}

/**
 * Label shown in the tab strip.
 * @param tab Tab state.
 * @returns Shell title when set, else `shell · folder`, else a placeholder.
 */
export function terminalTabLabel(tab: TerminalTab): string {
  if (tab.title.trim()) {
    return tab.title.trim();
  }
  if (tab.info) {
    return `${shellProgramName(tab.info.shell)} · ${pathBasename(tab.info.cwd)}`;
  }
  return tab.status === "failed" ? "Terminal (failed)" : "Terminal";
}

/**
 * One-line human detail for an ended terminal (tab tooltip).
 * @param exit Final state from the bridge channel.
 */
export function terminalExitDetail(exit: TerminalExit): string {
  if (exit.reason === "killed") {
    return "Terminated";
  }
  if (exit.reason === "exited") {
    return `Process exited with code ${exit.exitCode ?? "?"}`;
  }
  const prefix = exit.reason === "disconnected" ? "Disconnected" : "Error";
  return exit.message ? `${prefix}: ${exit.message}` : prefix;
}

/**
 * Text written into the terminal when it ends (dim, on its own line).
 * @param exit Final state.
 * @returns ANSI-styled banner terminated by CRLF.
 */
export function terminalExitBanner(exit: TerminalExit): string {
  return `\r\n\u001b[2m[${terminalExitDetail(exit)}]\u001b[0m\r\n`;
}
