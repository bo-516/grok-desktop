/**
 * ⌘K command palette (F-CMD-06 / F-NATIVE-01) — actions, settings, slash
 * commands, MCP servers, skills. Sessions stay in the sidebar search.
 */

import { useCommandPaletteWidget } from "./useCommandPaletteWidget";
import { CommandPaletteItemView } from "./CommandPaletteItemView";

export type CommandPaletteWidgetProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Stateful palette shell: input + ranked list. Catalog and run live in the hook.
 * @param props open/onClose — parent owns visibility; Escape closes even when focus leaves the input
 */
export function CommandPaletteWidget(props: CommandPaletteWidgetProps) {
  const { open, onClose } = props;
  const { query, setQuery, active, setActive, items, run } =
    useCommandPaletteWidget({ open, onClose });

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="palette-panel"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder="Search commands, settings, MCP, skills…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
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
              <CommandPaletteItemView
                item={item}
                active={i === active}
                onHover={() => setActive(i)}
                onRun={() => void run(item)}
              />
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
