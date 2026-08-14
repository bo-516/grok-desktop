/**
 * One ⌘K row: kind badge + truncated label/description.
 * Overflowing text opens OverflowTextView's pre tip; the rest of the row runs.
 */

import cs from "classnames";
import { OverflowTextView } from "@/widgets/shared";
import type { PaletteItem } from "../lib/commandPalette";

export type CommandPaletteItemViewProps = {
  /** Ranked catalog row. */
  item: PaletteItem;
  /** Keyboard / hover highlight. */
  active: boolean;
  /** Highlight this row. */
  onHover: () => void;
  /** Run the row (ignored when an overflow tip swallows the click). */
  onRun: () => void;
};

/**
 * Presentation-only palette row.
 * @param props item + active + hover/run from the palette hook.
 */
export function CommandPaletteItemView(props: CommandPaletteItemViewProps) {
  const { item, active, onHover, onRun } = props;
  return (
    <button
      type="button"
      className={cs("palette-item", { "palette-item-active": active })}
      onMouseEnter={onHover}
      onClick={onRun}
    >
      <span className="palette-kind">{item.kind}</span>
      <OverflowTextView className="palette-label" text={item.label} />
      <OverflowTextView className="palette-desc" text={item.description ?? ""} />
    </button>
  );
}
