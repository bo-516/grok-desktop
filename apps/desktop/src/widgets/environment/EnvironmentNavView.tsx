/**
 * Left nav for the Environment sheet — one row per domain page with count badge.
 * Stateless listbox; parent owns selection and counts.
 */

import cs from "classnames";
import type { EnvironmentPageId } from "@/store/environmentStore";

/** One navigable Environment page with optional live count. */
export type EnvironmentNavItem = {
  /** Page id for setPage / deep links. */
  id: EnvironmentPageId;
  /** Visible label. */
  label: string;
  /** Count badge; omit when unknown or not applicable. */
  count?: number;
  /** Phase-2 stub: shown but not fully interactive (still selectable). */
  soon?: boolean;
};

export type EnvironmentNavViewProps = {
  /** Ordered nav items. */
  items: EnvironmentNavItem[];
  /** Currently selected page. */
  active: EnvironmentPageId;
  /** Select a page. */
  onSelect: (id: EnvironmentPageId) => void;
};

/**
 * Renders the Environment left nav as a listbox.
 * @param props items/active/onSelect — missing onSelect leaves selection stuck.
 * @returns Nav column with active styling and optional counts.
 */
export function EnvironmentNavView(props: EnvironmentNavViewProps) {
  const { items, active, onSelect } = props;
  return (
    <nav className="env-nav" aria-label="Environment sections" role="listbox">
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={cs("env-nav-item", {
              "env-nav-item-active": selected,
            })}
            onClick={() => onSelect(item.id)}
          >
            <span className="env-nav-label">
              {item.label}
              {item.soon ? " · soon" : ""}
            </span>
            {item.count != null ? (
              <span className="env-nav-count" aria-hidden="true">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
