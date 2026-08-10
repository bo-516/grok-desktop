/**
 * Pure chat canvas presentation: ordered stream of user / turn / error.
 * Residual work units (tool_group / thought_group / lone agent|thought|tool)
 * funnel through TurnStepView only — no parallel JSX tree.
 * Stateful orchestration lives in useTimelineWidget / TimelineWidget.
 */

import type { MouseEvent, RefObject, UIEvent } from "react";
import type {
  SessionStatus,
  TimelineItem,
  ToolCallCard,
} from "@grok-desktop/acp-core";
import type { TimelineSearchHit } from "@/lib/timelineSearch";
import {
  isTurnLive as isTurnLiveFn,
  type TimelineRenderUnitWithTurns,
} from "@/lib/turnGrouping";
import {
  BlurText,
  FadeContent,
  ShinyText,
} from "@/components/react-bits";
import { TurnBlockWidget } from "./TurnBlockWidget";
import { TurnStepView } from "./TurnStepView";
import { UserMessageView } from "./UserMessageView";

export type TimelineViewProps = {
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard | undefined>;
  status: SessionStatus;
  units: TimelineRenderUnitWithTurns[];
  isRestoring: boolean;
  isEmpty: boolean;
  findOpen: boolean;
  findQuery: string;
  findIndex: number;
  hits: TimelineSearchHit[];
  activeHit: TimelineSearchHit | undefined;
  scrollRef: RefObject<HTMLDivElement | null>;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  handleMessageClick: (event: MouseEvent<HTMLDivElement>) => void;
  setFindOpen: (open: boolean) => void;
  setFindQuery: (query: string) => void;
  setFindIndex: (updater: number | ((i: number) => number)) => void;
  /** Bound isTurnLive from turnGrouping (injected for pure tests). */
  isTurnLive: typeof isTurnLiveFn;
};

/**
 * Renders the ordered ACP timeline as user / turn / error top-level units.
 * @param props Presentation model from useTimelineWidget; no store access.
 * @returns An empty-state guide when the session has no events, or the live chat canvas.
 */
export function TimelineView(props: TimelineViewProps) {
  const {
    timeline,
    toolCalls,
    status,
    units,
    isRestoring,
    isEmpty,
    findOpen,
    findQuery,
    findIndex,
    hits,
    activeHit,
    scrollRef,
    handleScroll,
    handleMessageClick,
    setFindOpen,
    setFindQuery,
    setFindIndex,
    isTurnLive,
  } = props;

  // Uncached session mid-restore: replay is silent, so the New chat guide would
  // claim an empty conversation that is actually still loading.
  if (isRestoring) {
    return (
      <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
        <div className="empty">
          <p className="empty-sub">
            <ShinyText text="Restoring conversation…" speed="slow" />
          </p>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
        <div className="empty">
          <BlurText
            text="What can I help with?"
            className="empty-title"
            animateBy="words"
            delay={70}
          />
          <FadeContent delayMs={180} blur>
            <p className="empty-sub">
              Describe a task for live grok-build. Use @ to attach files and /
              for commands.
            </p>
          </FadeContent>
          <p className="empty-sub">
            <ShinyText text="Live grok-build · ready when you are" speed="slow" />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="timeline"
      ref={scrollRef}
      data-status={status}
      onScroll={handleScroll}
      onClick={handleMessageClick}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setFindOpen(true);
        }
      }}
      tabIndex={-1}
    >
      {findOpen ? (
        <div className="timeline-find" role="search">
          <input
            className="text-input"
            autoFocus
            placeholder="Find in conversation"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              setFindIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFindOpen(false);
              }
              if (e.key === "Enter" && hits.length > 0) {
                setFindIndex((i) => (i + 1) % hits.length);
              }
            }}
          />
          <span className="timeline-find-count">
            {hits.length === 0 ? "0" : `${findIndex + 1}/${hits.length}`}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setFindOpen(false)}
          >
            Close
          </button>
        </div>
      ) : null}
      {units.map((unit, unitIndex) => {
        if (unit.type === "turn") {
          const live = isTurnLive(units, unitIndex, status);
          const answerId = unit.answer?.item.id;
          const isLastAnswer =
            answerId !== undefined &&
            timeline[timeline.length - 1]?.id === answerId;
          const answerShowCursor = status === "streaming" && isLastAnswer;
          const answerHighlight =
            answerId !== undefined && activeHit?.itemId === answerId;
          // One FadeContent per turn so rail repartition does not re-enter every step.
          return (
            <FadeContent key={unit.id} className="msg-agent-wrap" durationMs={320}>
              <TurnBlockWidget
                unit={unit}
                live={live}
                sessionStatus={status}
                toolCalls={toolCalls}
                answerShowCursor={answerShowCursor}
                answerHighlight={answerHighlight}
              />
            </FadeContent>
          );
        }
        // User / error stay top-level; residual work units share TurnStepView.
        if (unit.type === "item") {
          const item = unit.item;
          const highlight = activeHit?.itemId === item.id;
          if (item.kind === "user") {
            return (
              <FadeContent key={item.id} durationMs={320}>
                <UserMessageView blocks={item.blocks} highlight={highlight} />
              </FadeContent>
            );
          }
          if (item.kind === "error") {
            return (
              <FadeContent key={item.id} className="msg-agent-wrap">
                <div className="item-error" data-kind="error">
                  {item.message}
                </div>
              </FadeContent>
            );
          }
          // Residual agent / thought / tool outside a turn (fixtures / bypass).
          return (
            <FadeContent key={item.id} className="msg-agent-wrap" durationMs={320}>
              <TurnStepView
                child={unit}
                sessionStatus={status}
                toolCalls={toolCalls}
              />
            </FadeContent>
          );
        }
        // Residual tool_group / thought_group: same step renderer as in-turn.
        return (
          <FadeContent key={unit.id} className="msg-agent-wrap" durationMs={320}>
            <TurnStepView
              child={unit}
              sessionStatus={status}
              toolCalls={toolCalls}
            />
          </FadeContent>
        );
      })}
    </div>
  );
}
