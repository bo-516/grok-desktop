/**
 * Trailing action cluster for one session rail row.
 * A single parent (`sess-actions`) reserves a 56px track and renders
 * rename + pin + remove as one `sess-btns` group (three 14×28 slots,
 * 2px gaps) pushed to the track's right edge, so the trailing × lines up
 * with the relative timestamp painted on the rows above. Time overlays the
 * right 24px of that same track so hover-reveal never shifts the title
 * truncation point. Remove no longer lives in a wider, right-aligned time
 * column — the three glyphs share one cadence. Pin stays painted when
 * pinned; rename stays painted while editing (row classes, not this view).
 */

import cs from "classnames";
import { Check, Pencil, Pin, X } from "lucide-react";
import { useRef, type RefObject } from "react";

/** Props for the row's trailing rename / pin / remove + resting time. */
export type SessionRailSessionActionsViewProps = {
  /** Accessible name stem (rail title) for button labels. */
  titleLabel: string;
  /** True while the title cell is an input; shows Save instead of pencil. */
  editing: boolean;
  /** Pin stays visible at rest when true (row class drives opacity). */
  pinned: boolean;
  /** Compact relative time for the resting overlay (`45s` / `1d` / `now`). */
  timeLabel: string;
  /** Tooltip on the time slot (same compact string today). */
  fullTime: string;
  /**
   * Handle to the title input so Save can read the draft on mousedown
   * before blur unmounts the field. Missing/empty yields an empty commit.
   */
  titleInputRef: RefObject<HTMLInputElement | null>;
  /** Enter rename; missing leaves the pencil control inert. */
  onBeginRename?: () => void;
  /**
   * Persist the typed title (Save mousedown). Empty / unchanged is the
   * action's job to ignore.
   * @param nextTitle Current input value (unsanitized).
   */
  onCommitRename?: (nextTitle: string) => void;
  /** Toggle pin for this session only (does not pin the project folder). */
  onTogglePin: () => void;
  /** Remove this session from the rail list. */
  onRemove: () => void;
};

/**
 * Rename + pin + remove as one parent-owned cluster, with time overlaid
 * on the reserved right edge at rest.
 * Save uses mousedown so the input is still mounted when we read it; the
 * trailing click is ignored so commit does not immediately reopen edit.
 * Mouse clicks blur the control so `group-focus-within` does not keep
 * the cluster visible after the pointer leaves; keyboard (detail 0)
 * keeps focus so tabbing stays discoverable.
 * @param props Title stem, edit/pin flags, time labels, input ref, handlers.
 * @returns Trailing action cluster for one session row.
 */
export function SessionRailSessionActionsView(
  props: SessionRailSessionActionsViewProps,
) {
  const {
    titleLabel,
    editing,
    pinned,
    timeLabel,
    fullTime,
    titleInputRef,
    onBeginRename,
    onCommitRename,
    onTogglePin,
    onRemove,
  } = props;
  const pinLabel = pinned
    ? `Unpin ${titleLabel}`
    : `Pin ${titleLabel} to top`;
  /**
   * Save uses mousedown (to read the input before blur). The trailing click
   * would see `editing === false` after commit and reopen the field — skip it.
   */
  const skipRenameClickRef = useRef(false);

  return (
    <span className="sess-actions">
      <span className="sess-btns">
        <button
          type="button"
          className={cs("sess-rename", {
            "sess-rename-save": editing,
          })}
          title={editing ? "Save name" : `Rename ${titleLabel}`}
          aria-label={editing ? "Save name" : `Rename ${titleLabel}`}
          onMouseDown={(e) => {
            // Save: keep the input focused until we read it (blur would
            // unmount the field first and the click would reopen edit).
            if (editing) {
              e.preventDefault();
              e.stopPropagation();
              skipRenameClickRef.current = true;
              onCommitRename?.(titleInputRef.current?.value ?? "");
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (skipRenameClickRef.current) {
              skipRenameClickRef.current = false;
              return;
            }
            if (e.detail > 0) {
              e.currentTarget.blur();
            }
            if (!editing) {
              onBeginRename?.();
            }
          }}
        >
          {editing ? (
            <Check
              className="sess-rename-icon"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : (
            <Pencil
              className="sess-rename-icon"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          className={cs("sess-pin", {
            "sess-pin-active": pinned,
          })}
          title={pinLabel}
          aria-label={pinLabel}
          aria-pressed={pinned}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
            // Mouse click leaves focus on the pin; group-focus-within would keep
            // the cluster visible after the pointer leaves. Keyboard (detail 0)
            // keeps focus so the control stays discoverable while tabbing.
            if (e.detail > 0) {
              e.currentTarget.blur();
            }
          }}
        >
          <Pin
            className="sess-pin-icon"
            strokeWidth={1.75}
            fill={pinned ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="sess-remove"
          title="Remove from list"
          aria-label={`Remove ${titleLabel} from list`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X
            className="sess-remove-icon"
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </span>
      <span className="sess-time" title={fullTime}>
        {timeLabel}
      </span>
    </span>
  );
}
