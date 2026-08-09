/**
 * ⌘K command palette (F-CMD-06 / F-NATIVE-01) — sessions, slash commands, settings.
 * Primary home for slash/media/ops that Claude/Codex keep out of permanent top-nav.
 */

import cs from "classnames";
import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  commandsToPaletteItems,
  defaultPaletteActions,
  filterPaletteItems,
  openAppPanel,
  prefillComposer,
  sessionsToPaletteItems,
  type PaletteItem,
} from "../lib/commandPalette";
import { applyTheme, loadTheme, toggleTheme } from "../lib/theme";

export type CommandPaletteWidgetProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Stateful palette: filters local catalog + agent commands; runs actions via store.
 * @param props open/onClose — parent owns visibility; Escape closes even when focus leaves the input
 */
export function CommandPaletteWidget(props: CommandPaletteWidgetProps) {
  const { open, onClose } = props;
  const catalog = useSessionStore((s) => s.catalog);
  const commands = useSessionStore((s) => s.session.availableCommands);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const runCli = useSessionStore((s) => s.runCli);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const all: PaletteItem[] = [
      ...defaultPaletteActions(),
      ...sessionsToPaletteItems(
        catalog.map((c) => ({ id: c.id, title: c.title })),
      ),
      ...commandsToPaletteItems(commands ?? []),
    ];
    return filterPaletteItems(all, query, 24);
  }, [catalog, commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  // Escape closes even when focus left the search input (global while open).
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

  if (!open) {
    return null;
  }

  /**
   * Execute one palette row: sessions, slash send, panel open, or composer prefill.
   * @param item Ranked row from filterPaletteItems
   */
  const run = async (item: PaletteItem) => {
    onClose();
    if (item.kind === "session" && item.runValue) {
      selectSession(item.runValue);
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
    if (item.runValue === "open_extensions") {
      openAppPanel("extensions");
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
    if (item.runValue === "open_tasks") {
      openAppPanel("tasks");
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
    if (item.runValue === "prefill_imagine") {
      prefillComposer("/imagine ");
      return;
    }
    if (item.runValue === "prefill_imagine_video") {
      prefillComposer("/imagine-video ");
      return;
    }
    // Fire-and-forget slash (usage, privacy, compact, fork, …)
    if (item.kind === "command" && item.runValue) {
      await sendPrompt(`/${item.runValue}`);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="palette-panel"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder="Search sessions, commands, settings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              props.onClose();
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") {
              const selected = items[active];
              if (selected) {
                e.preventDefault();
                void run(selected);
              }
            }
          }}
        />
        <ul className="palette-list">
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className={cs("palette-item", {
                  "palette-item-active": i === active,
                })}
                onMouseEnter={() => setActive(i)}
                onClick={() => void run(item)}
              >
                <span className="palette-kind">{item.kind}</span>
                <span className="palette-label">{item.label}</span>
                {item.description ? (
                  <span className="palette-desc">{item.description}</span>
                ) : null}
              </button>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="palette-empty">No matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
