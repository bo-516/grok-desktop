/**
 * Single entry hook for the Environment sheet — load, page, counts, actions.
 * Pages select their own store fields; this hook assembles sheet-level chrome.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useSessionStore } from "@/store/sessionStore";
import {
  formatLoadedAgo,
  useEnvironmentStore,
  type EnvironmentPageId,
} from "@/store/environmentStore";
import type { EnvironmentNavItem } from "./EnvironmentNavView";

export type UseEnvironmentWidgetArgs = {
  /** Whether the sheet is open — triggers load-on-open. */
  open: boolean;
  /** Close the sheet (shell). */
  onClose: () => void;
  /**
   * Optional page to open when the sheet becomes visible (deep link).
   * Applied once per open cycle via store setPage.
   */
  initialPage?: EnvironmentPageId;
};

/**
 * Assembles Environment sheet state and handlers.
 * @param args open/onClose/initialPage from EnvironmentSheetWidget.
 * @returns Nav items, page body data, and chrome handlers.
 */
export function useEnvironmentWidget(args: UseEnvironmentWidgetArgs) {
  const { open, onClose, initialPage } = args;
  const runCli = useSessionStore((s) => s.runCli);
  const workspace = useSessionStore((s) => s.session.workspace);

  const page = useEnvironmentStore((s) => s.page);
  const snapshot = useEnvironmentStore((s) => s.snapshot);
  const status = useEnvironmentStore((s) => s.status);
  const error = useEnvironmentStore((s) => s.error);
  const loadedAt = useEnvironmentStore((s) => s.loadedAt);
  const pending = useEnvironmentStore((s) => s.pending);
  const setPage = useEnvironmentStore((s) => s.setPage);
  const load = useEnvironmentStore((s) => s.load);
  const runDoctor = useEnvironmentStore((s) => s.runDoctor);
  const clearError = useEnvironmentStore((s) => s.clearError);

  // Apply deep-link page when opening.
  useEffect(() => {
    if (open && initialPage) {
      setPage(initialPage);
    }
  }, [open, initialPage, setPage]);

  // Load (or refresh if stale) whenever the sheet opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    void load(runCli);
  }, [open, load, runCli]);

  const loading = status === "loading";
  const loadedLabel = formatLoadedAgo(loadedAt);

  const refresh = useCallback(() => {
    void load(runCli, { force: true });
  }, [load, runCli]);

  const onDoctor = useCallback(
    (name: string) => {
      void runDoctor(runCli, name);
    },
    [runDoctor, runCli],
  );

  const navItems: EnvironmentNavItem[] = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      {
        id: "mcp",
        label: "MCP servers",
        count: snapshot?.mcpServers.length,
      },
      {
        id: "skills",
        label: "Skills",
        count: snapshot?.skills.length,
      },
      {
        id: "agents",
        label: "Agents",
        count: snapshot?.agents.length,
        soon: true,
      },
      {
        id: "plugins",
        label: "Plugins",
        count: snapshot?.plugins.length,
        soon: true,
      },
      {
        id: "marketplaces",
        label: "Marketplaces",
        count: snapshot?.marketplaces.length,
        soon: true,
      },
      {
        id: "hooks",
        label: "Hooks",
        count: snapshot?.hooks.length,
        soon: true,
      },
      {
        id: "rules",
        label: "Rules",
        count: snapshot?.instructions.length,
        soon: true,
      },
      {
        id: "compat",
        label: "Compatibility",
        count: snapshot?.compat.length,
        soon: true,
      },
    ],
    [snapshot],
  );

  return {
    open,
    onClose,
    page,
    setPage,
    snapshot,
    status,
    error,
    clearError,
    loading,
    loadedLabel,
    workspace: workspace || snapshot?.cwd || undefined,
    pending,
    navItems,
    refresh,
    onDoctor,
    mcpRows: snapshot?.mcpServers ?? [],
    skillRows: snapshot?.skills ?? [],
  };
}

export type EnvironmentWidgetModel = ReturnType<typeof useEnvironmentWidget>;
