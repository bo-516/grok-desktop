/**
 * ⌘K catalog + run handlers. Sessions stay in the sidebar; this hook lists
 * actions, settings, slash commands, MCP servers, and skills.
 */

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  selectMcpRows,
  selectSkillRows,
  useEnvironmentStore,
} from "../store/environmentStore";
import {
  buildPaletteCatalog,
  filterPaletteItems,
  openAppPanel,
  openAppRail,
  openEnvironment,
  prefillComposer,
  type PaletteItem,
} from "../lib/commandPalette";
import { applyTheme, loadTheme, toggleTheme } from "../lib/theme";

/** Empty-query cap: curated actions + MCP + skills should all be reachable. */
const PALETTE_IDLE_LIMIT = 80;
/** Ranked search cap so a vague query cannot dump the whole inspect snapshot. */
const PALETTE_SEARCH_LIMIT = 32;

export type UseCommandPaletteWidgetArgs = {
  /** Parent-owned visibility. */
  open: boolean;
  /** Close the dialog after a run or Escape. */
  onClose: () => void;
};

export type UseCommandPaletteWidgetResult = {
  /** Current filter string. */
  query: string;
  /** Replace the filter; resets the highlight to the first row. */
  setQuery: (value: string) => void;
  /** Highlighted row index in `items`. */
  active: number;
  /** Highlight a row (keyboard or hover). */
  setActive: (value: number | ((prev: number) => number)) => void;
  /** Ranked rows for the current query. */
  items: PaletteItem[];
  /**
   * Run one row then close. MCP opens Environment → MCP; invocable skills
   * prefill the composer; everything else matches the curated action ids.
   */
  run: (item: PaletteItem) => Promise<void>;
};

/**
 * Assemble palette catalog, environment load-on-open, and run dispatch.
 * @param args open/onClose from CommandPaletteWidget.
 */
export function useCommandPaletteWidget(
  args: UseCommandPaletteWidgetArgs,
): UseCommandPaletteWidgetResult {
  const { open, onClose } = args;
  const commands = useSessionStore((s) => s.session.availableCommands);
  const newSession = useSessionStore((s) => s.newSession);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const forkSession = useSessionStore((s) => s.forkSession);
  const runCli = useSessionStore((s) => s.runCli);
  const snapshot = useEnvironmentStore((s) => s.snapshot);
  const loadEnv = useEnvironmentStore((s) => s.load);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const all = buildPaletteCatalog({
      commands: commands ?? [],
      mcpServers: selectMcpRows(snapshot),
      skills: selectSkillRows(snapshot),
    });
    const limit = query.trim() ? PALETTE_SEARCH_LIMIT : PALETTE_IDLE_LIMIT;
    return filterPaletteItems(all, query, limit);
  }, [commands, snapshot, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  // Pull inspect ⊕ mcp list when the palette opens so MCP / skill rows appear.
  useEffect(() => {
    if (!open) {
      return;
    }
    void loadEnv(runCli);
  }, [open, loadEnv, runCli]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * Execute one palette row: chrome open, slash send, or composer prefill.
   * @param item Ranked row from filterPaletteItems
   */
  const run = async (item: PaletteItem) => {
    onClose();
    if (item.kind === "mcp") {
      openEnvironment("mcp");
      return;
    }
    if (item.kind === "skill") {
      if (item.invokeAsSlash && item.runValue) {
        prefillComposer(`/${item.runValue} `);
        return;
      }
      openEnvironment("skills");
      return;
    }
    if (item.runValue === "new_chat") {
      void newSession();
      return;
    }
    if (item.runValue === "auth_login") {
      void runCli("auth_login");
      return;
    }
    if (item.runValue === "open_environment") {
      openEnvironment("overview");
      return;
    }
    if (item.runValue === "open_env_plugins") {
      openEnvironment("plugins");
      return;
    }
    if (item.runValue === "open_settings") {
      openAppPanel("settings");
      return;
    }
    if (item.runValue === "open_overview") {
      openAppPanel("overview");
      return;
    }
    if (item.runValue === "open_agents") {
      openAppRail("agents");
      return;
    }
    if (item.runValue === "open_rewind") {
      window.dispatchEvent(new CustomEvent("grok-desktop:open-rewind"));
      return;
    }
    if (item.runValue === "toggle_theme") {
      const next = toggleTheme(loadTheme());
      applyTheme(next);
      return;
    }
    if (item.runValue === "prefill_model") {
      prefillComposer("/model ");
      return;
    }
    if (item.runValue === "prefill_effort") {
      prefillComposer("/effort ");
      return;
    }
    if (item.runValue === "prefill_imagine") {
      prefillComposer("/imagine ");
      return;
    }
    if (item.runValue === "prefill_imagine_video") {
      prefillComposer("/imagine-video ");
      return;
    }
    if (item.kind === "command" && item.runValue === "fork") {
      void forkSession();
      return;
    }
    if (item.kind === "command" && item.runValue) {
      await sendPrompt(`/${item.runValue}`);
    }
  };

  return { query, setQuery, active, setActive, items, run };
}
