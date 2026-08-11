/**
 * Stateless live-turn strip: pulse orb + shimmering verb + step detail + clock.
 *
 * Rendered as the tail of the transcript and stuck to the bottom of the scroll
 * area, so the one signal that says "the agent is busy" trails the newest
 * message and stays visible while reading back — not parked in the top-right
 * corner. Chrome (sticky offset, opaque fill) lives in the `turn-status`
 * shortcut; this file only orders the parts.
 */

import { ShinyText } from "@/components/react-bits";

export type TurnStatusViewProps = {
  /** Present-tense headline (`Reading`, `Thinking`); never empty. */
  verb: string;
  /** Optional current-step detail; empty hides the separator with it. */
  detail: string;
  /** Preformatted wall duration (`8s`, `3m 8s`); never empty while mounted. */
  elapsedLabel: string;
};

/**
 * One-line status pill; hugs its content so it never reads as a second toolbar.
 * @param props Resolved verb / detail / elapsed strings — no formatting here.
 * @returns Polite live region announcing verb + detail (clock stays silent).
 */
export function TurnStatusView(props: TurnStatusViewProps) {
  const { verb, detail, elapsedLabel } = props;
  return (
    <div
      className="turn-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Radar ping + core: motion that survives at 8px, unlike a spinner. */}
      <span className="turn-status-orb" aria-hidden="true">
        <span className="turn-status-orb-ping" />
        <span className="turn-status-orb-core" />
      </span>
      <ShinyText className="turn-status-verb" text={verb} speed="fast" />
      {detail ? (
        <span className="turn-status-detail" title={detail}>
          {detail}
        </span>
      ) : null}
      {/*
        Clock + hint are aria-hidden: a per-second tick inside a live region
        would make screen readers re-announce the whole strip every second.
      */}
      <span className="turn-status-meta" aria-hidden="true">
        <span className="turn-status-dot">·</span>
        <span className="turn-status-time">{elapsedLabel}</span>
        <span className="turn-status-dot">·</span>
        <kbd className="turn-status-kbd">esc</kbd>
        <span className="turn-status-hint">to stop</span>
      </span>
    </div>
  );
}
