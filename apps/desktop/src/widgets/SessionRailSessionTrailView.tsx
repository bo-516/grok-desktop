/**
 * Trailing slot of one session rail row: resting meta + the ⋯ menu chip.
 *
 * Both children are stacked in one grid cell (`sess-trail`), so the cell is
 * as wide as the wider of the two and the hover swap never moves the
 * title's truncation point. At rest the meta shows the compact relative
 * time, a pin mark ahead of it on pinned chats, and — while the agent
 * works — a spinner (streaming) or a dot (waiting for approval) in place of
 * the time. Row hover, keyboard focus in the row, or an open menu hide the
 * meta and show the ⋯ chip; rename / pin / delete live behind it.
 * Which of the two shows is pure CSS (row `group` + `sess-row-menu-open`).
 */

import { LoaderCircle, Pin } from "lucide-react";
import type { ReactNode } from "react";

/** What the agent behind a row is doing right now (meta glyph choice). */
export type SessionRowActivity = "idle" | "streaming" | "waiting";

/** Props for {@link SessionRailSessionTrailView}. */
export type SessionRailSessionTrailViewProps = {
  /** Paint the pin mark ahead of the time. */
  pinned: boolean;
  /** Live state; streaming / waiting replace the time with a glyph. */
  activity: SessionRowActivity;
  /** Compact relative time (`now` / `45s` / `12m` / `3d` / `1mo`). */
  timeLabel: string;
  /**
   * The ⋯ chip, built by the row widget as a DropdownMenu trigger (it must
   * render inside that menu's root). Missing renders the meta only, e.g. in
   * isolated mounts.
   */
  menuButton?: ReactNode;
};

/**
 * Time, or the live glyph that replaces it. Glyphs carry screen-reader
 * text because the row's accessible name is built from its content.
 * @param props Activity and the compact time string.
 * @returns Waiting dot, spinner, or the time label.
 */
function SessionRowStatusView(props: {
  activity: SessionRowActivity;
  timeLabel: string;
}) {
  if (props.activity === "waiting") {
    return (
      <>
        <span className="sess-meta-wait" aria-hidden="true" />
        <span className="sr-only">Waiting for approval</span>
      </>
    );
  }
  if (props.activity === "streaming") {
    return (
      <>
        <LoaderCircle
          className="sess-meta-live"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="sr-only">Running</span>
      </>
    );
  }
  return <span>{props.timeLabel}</span>;
}

/**
 * Meta + ⋯ chip for one row. Stateless: the chip arrives ready-made from
 * the row widget; visibility swaps are CSS.
 * @param props Pin / activity / time meta and the optional menu chip.
 * @returns Trailing grid cell for the session row.
 */
export function SessionRailSessionTrailView(
  props: SessionRailSessionTrailViewProps,
) {
  const { pinned, activity, timeLabel, menuButton } = props;
  return (
    <span className="sess-trail">
      <span className="sess-meta">
        {pinned ? (
          <>
            <Pin
              className="sess-meta-pin"
              strokeWidth={2}
              fill="currentColor"
              aria-hidden="true"
            />
            <span className="sr-only">Pinned</span>
          </>
        ) : null}
        <SessionRowStatusView activity={activity} timeLabel={timeLabel} />
      </span>
      {menuButton}
    </span>
  );
}
