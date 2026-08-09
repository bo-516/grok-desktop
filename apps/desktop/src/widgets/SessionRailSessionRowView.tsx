/**
 * Stateless session list row + footer live status for the session rail.
 */

import cs from "classnames";
import { ShinyText } from "@/components/react-bits";
import {
  formatRelativeTime,
  type SessionRecord,
} from "@/store/sessionCatalog";

/**
 * Footer agent status: offline / N running (shine only while AI is outputting).
 * `liveCount` is sessions with `live && status === "streaming"` — not idle
 * pool residents. Pool pushes + 1s list_pool keep the number honest.
 * @param props live-bridge flag and streaming session count.
 */
export function SessionRailFooterLiveStatus(props: {
  live: boolean;
  liveCount: number;
}) {
  if (!props.live) {
    return <>Offline</>;
  }
  if (props.liveCount > 0) {
    return <ShinyText text={`${props.liveCount} running`} speed="slow" />;
  }
  return <>0 running</>;
}

/**
 * One session row: title (ellipsis) + meta slot (relative time / remove).
 * Grid columns keep title and meta paint-separated so long titles never
 * overlap `now` / `2h` / `yesterday` on narrow sidebar width.
 * @param props Session record, selection / live flags, select + remove handlers.
 * @returns Interactive row for the side-nav session list.
 */
export function SessionRailSessionRowView(props: {
  rec: SessionRecord;
  selected: boolean;
  isLiveActive: boolean;
  liveStatus: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { rec, selected, isLiveActive, liveStatus, onSelect, onRemove } = props;
  const timeLabel =
    liveStatus === "streaming" && isLiveActive
      ? "…"
      : formatRelativeTime(rec.updatedAt);

  return (
    <div
      className={cs("sess-row group", {
        "sess-row-active": selected,
        "sess-row-process-live": isLiveActive && liveStatus === "streaming",
      })}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="sess-title" title={rec.title}>
        {rec.title}
      </span>
      <span className="sess-meta">
        <span className="sess-time" title={formatRelativeTime(rec.updatedAt)}>
          {timeLabel}
        </span>
        <button
          type="button"
          className="sess-remove"
          title="Remove from list"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </span>
    </div>
  );
}
