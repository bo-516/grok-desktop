/**
 * Stateless session list row + footer live status for the session rail.
 * Pin is per-session within its workspace folder only (not per folder, and
 * does not float the project group): hover reveals the pin control; a pinned
 * row keeps the pin visible and stays at the top of its project list via
 * prefs. Rename / pin / remove render from one parent cluster
 * (`SessionRailSessionActionsView`) so the three glyphs share a cadence;
 * double-clicking the title swaps in a borderless input. Rows are
 * HTML5-draggable so the user can reorder within a project; drag order
 * outranks last-message recency auto-sort.
 */

import cs from "classnames";
import { memo, useRef, type DragEvent } from "react";
import { ShinyText } from "@/components/react-bits";
import { railSessionTitle } from "@/lib/sessionTitleEdit";
import {
  formatRelativeTime,
  type SessionRecord,
} from "@/store/sessionCatalog";
import { SessionRailSessionActionsView } from "./SessionRailSessionActionsView";
import { SessionRailSessionTitleView } from "./SessionRailSessionTitleView";

/** dataTransfer type so drops only accept session-rail rows. */
const SESSION_DRAG_MIME = "application/x-grok-session-id";

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

/** Props for one session rail row (memoized against catalog churn). */
export type SessionRailSessionRowProps = {
  rec: SessionRecord;
  selected: boolean;
  isLiveActive: boolean;
  liveStatus: string;
  /** Whether this chat is pinned to the top of its project list. */
  pinned: boolean;
  onSelect: () => void;
  onRemove: () => void;
  /**
   * Toggle pin for this session only (within its workspace; does not pin
   * or float the project folder).
   */
  onTogglePin: () => void;
  /**
   * Reorder within the same project after a successful drop.
   * @param fromId Dragged session id.
   * @param toId Drop-target session id (fromId moves to this index).
   */
  onReorder?: (fromId: string, toId: string) => void;
  /** True while this row's title is an input. */
  editing?: boolean;
  /** Double-click title or the pencil control; missing leaves the title read-only. */
  onBeginRename?: () => void;
  /**
   * Persist the typed title (Enter, blur, or the check control).
   * @param nextTitle Current input value.
   */
  onCommitRename?: (nextTitle: string) => void;
  /** Escape (or an empty commit at the store) leaves the previous title. */
  onCancelRename?: () => void;
};

/**
 * Inner session row render function (memo-wrapped below).
 * Title and the action cluster are separate grid tracks so long titles
 * never overlap buttons. Trailing rename / pin / remove live in
 * `SessionRailSessionActionsView` (one reserved 56px parent). Selected
 * state is a quiet elevated fill + medium title. Drag-and-drop reorders
 * within the parent project; a short drag does not fire select.
 * Wrapped in React.memo so catalog identity churn without prop changes
 * does not re-render every rail row.
 * @param props Session record, selection / live / pin / rename flags, handlers.
 * @returns Interactive row for the side-nav session list.
 */
function SessionRailSessionRowViewInner(props: SessionRailSessionRowProps) {
  const {
    rec,
    selected,
    isLiveActive,
    liveStatus,
    pinned,
    onSelect,
    onRemove,
    onTogglePin,
    onReorder,
    editing = false,
    onBeginRename,
    onCommitRename,
    onCancelRename,
  } = props;
  const isStreaming = liveStatus === "streaming" && isLiveActive;
  const isWaiting = liveStatus === "waiting_permission" && isLiveActive;
  /** Friendly rail label; locked custom names skip the weak-title rewrite. */
  const titleLabel = railSessionTitle(rec);
  /** Handle so the Save control can read the input before blur unmounts it. */
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** Relative time already fits the 24px overlay (`45s` / `12m` / `1d`). */
  const fullTime = formatRelativeTime(rec.updatedAt);
  const timeLabel = isStreaming ? "…" : fullTime;
  /**
   * After a real drag, the browser still emits click — skip select once so
   * reordering does not also switch the active chat.
   */
  const skipClickRef = useRef(false);

  /**
   * Start an in-rail session drag. Payload is the session id only; drop
   * handlers ignore foreign mime types.
   * @param e Native dragstart from this row.
   */
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!onReorder || editing) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(SESSION_DRAG_MIME, rec.id);
    e.dataTransfer.setData("text/plain", rec.id);
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.setAttribute("data-dragging", "true");
  };

  /**
   * Allow drop only when the payload is another session row.
   * @param e Native dragover over this row.
   */
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!onReorder) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.setAttribute("data-drag-over", "true");
  };

  /**
   * Clear drag-over highlight when the pointer leaves this row.
   * @param e Native dragleave.
   */
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.currentTarget.removeAttribute("data-drag-over");
  };

  /**
   * Apply reorder when another session is dropped on this row.
   * @param e Native drop.
   */
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.currentTarget.removeAttribute("data-drag-over");
    if (!onReorder) {
      return;
    }
    e.preventDefault();
    const fromId =
      e.dataTransfer.getData(SESSION_DRAG_MIME) ||
      e.dataTransfer.getData("text/plain");
    if (!fromId || fromId === rec.id) {
      return;
    }
    skipClickRef.current = true;
    onReorder(fromId, rec.id);
  };

  /**
   * Clear dragging chrome; mark click to be ignored if a drag occurred.
   * @param e Native dragend.
   */
  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    e.currentTarget.removeAttribute("data-dragging");
    e.currentTarget.removeAttribute("data-drag-over");
    // dropEffect "none" means cancelled; still suppress the trailing click
    // when the browser treated the gesture as a drag (not a simple click).
    if (e.dataTransfer.dropEffect !== "none") {
      skipClickRef.current = true;
    }
  };

  return (
    <div
      className={cs("sess-row group", {
        "sess-row-active": selected,
        "sess-row-process-live": isStreaming,
        "sess-row-waiting": isWaiting,
        "sess-row-pinned": pinned,
        "sess-row-editing": editing,
      })}
      role="button"
      tabIndex={0}
      draggable={Boolean(onReorder) && !editing}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={() => {
        if (skipClickRef.current) {
          skipClickRef.current = false;
          return;
        }
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <SessionRailSessionTitleView
        label={titleLabel}
        rawTitle={rec.title}
        editing={editing}
        inputRef={titleInputRef}
        onBeginRename={() => onBeginRename?.()}
        onCommitRename={(nextTitle) => onCommitRename?.(nextTitle)}
        onCancelRename={() => onCancelRename?.()}
      />
      <SessionRailSessionActionsView
        titleLabel={titleLabel}
        editing={editing}
        pinned={pinned}
        timeLabel={timeLabel}
        fullTime={fullTime}
        titleInputRef={titleInputRef}
        onBeginRename={onBeginRename}
        onCommitRename={onCommitRename}
        onTogglePin={onTogglePin}
        onRemove={onRemove}
      />
    </div>
  );
}

/** Memoized rail row — skips re-render when catalog identity churns elsewhere. */
export const SessionRailSessionRowView = memo(SessionRailSessionRowViewInner);
SessionRailSessionRowView.displayName = "SessionRailSessionRowView";
