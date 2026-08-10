/**
 * File-path chips under a tool head (ACP `locations`).
 * Stateless: the parent card owns preview + copy state, this view only decides
 * how a path is shortened and how the two gestures map onto one row —
 * single click previews, double click copies the absolute path.
 */

import { toPathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

export type ToolLocationListViewProps = {
  /** Normalized location strings in agent order; empty renders nothing. */
  locations: string[];
  /** Workspace root for shortening; empty keeps every path absolute. */
  workspace: string;
  /** Absolute path currently flashing "Copied", or null. */
  copiedKey: string | null;
  /** Open the preview drawer for this location (raw agent string). */
  onOpen: (location: string) => void;
  /** Copy request for the resolved absolute path. */
  onCopy: (fullPath: string) => void;
};

/**
 * @param props Locations plus workspace context and the two row callbacks.
 * @returns Column of path chips, or null when the card has no locations.
 */
export function ToolLocationListView(props: ToolLocationListViewProps) {
  const { locations, workspace, copiedKey, onOpen, onCopy } = props;
  if (locations.length === 0) {
    return null;
  }
  return (
    <div className="tool-locations">
      {locations.map((loc) => {
        const display = toPathDisplay(loc, workspace);
        return (
          <button
            key={loc}
            type="button"
            className="tool-loc-link"
            title={`${display.full}\nClick to preview · double-click to copy path`}
            data-path={display.full}
            onClick={(event) => {
              // detail > 1 is the second click of a double-click, which copies.
              if (event.detail > 1) {
                return;
              }
              onOpen(loc);
            }}
            onDoubleClick={() => {
              onCopy(display.full);
            }}
          >
            <PathLabelView display={display} />
            {copiedKey === display.full ? (
              <span className="path-copied-flag">Copied</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
