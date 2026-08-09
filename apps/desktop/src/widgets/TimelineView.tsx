/**
 * Chat canvas: ordered stream of user / agent / thought / tool / error.
 * User bubbles align right; agent text + soft action row align left (Framer shell).
 * Tool bodies always read from the shared toolCalls map (patch-merge target).
 * Consecutive read/search tools collapse (F-TOOL-06).
 */

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { groupTimelineTools } from "../lib/toolGrouping";
import { searchTimeline } from "../lib/timelineSearch";
import {
  StreamingMarkdownView,
  ThoughtWidget,
  ToolCardView,
} from "@/widgets/timeline";
import { ToolGroupView } from "./timeline/ToolGroupView";
import {
  BlurText,
  FadeContent,
  ShinyText,
} from "@/components/react-bits";
import { MentionTextView } from "@/widgets/shared";

/**
 * Renders the ordered ACP timeline and hands Thought/Tool items to their display units.
 * @returns An empty-state guide when the session has no events, or the live chat canvas in event order.
 */
export function TimelineView() {
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const status = useSessionStore((s) => s.session.status);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);

  const units = useMemo(
    () => groupTimelineTools(timeline, toolCalls),
    [timeline, toolCalls],
  );
  const hits = useMemo(
    () => searchTimeline(timeline, findQuery),
    [timeline, findQuery],
  );

  // ⌘F conversation search (F-STREAM-14)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (timeline.length === 0) {
    return (
      <div className="timeline">
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

  const activeHit = hits[findIndex];

  return (
    <div
      className="timeline"
      data-status={status}
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
      {units.map((unit) => {
        if (unit.type === "tool_group") {
          return (
            <FadeContent key={unit.id} className="msg-agent-wrap" durationMs={360}>
              <ToolGroupView
                toolCallIds={unit.toolCallIds}
                kinds={unit.kinds}
                toolCalls={toolCalls}
              />
            </FadeContent>
          );
        }
        const item = unit.item;
        const highlight = activeHit?.itemId === item.id;
        if (item.kind === "user") {
          const text = item.blocks
            .map((b) => (b.type === "text" ? b.text : b.type))
            .join("");
          return (
            <FadeContent
              key={item.id}
              className="msg-user-wrap"
              durationMs={320}
            >
              <div
                className="item-user"
                data-kind="user"
                data-find-hit={highlight ? "1" : undefined}
              >
                {/* Sent text keeps its @file / /command tokens as chips so
                    history reads the same as the draft did (F-COMPOSER chips). */}
                <MentionTextView text={text} />
              </div>
            </FadeContent>
          );
        }
        if (item.kind === "agent") {
          const isLast = timeline[timeline.length - 1]?.id === item.id;
          const showCursor = status === "streaming" && isLast;
          return (
            <FadeContent
              key={item.id}
              className="msg-agent-wrap"
              durationMs={380}
            >
              <div
                className="msg-agent-inner group"
                data-find-hit={highlight ? "1" : undefined}
              >
                {item.text ? (
                  <div className="item-agent" data-kind="agent">
                    <StreamingMarkdownView
                      text={item.text}
                      showCursor={showCursor}
                    />
                  </div>
                ) : showCursor ? (
                  <div className="item-agent" data-kind="agent">
                    <div className="msg-status">
                      <ShinyText text="Generating response…" speed="fast" />
                    </div>
                    <div className="msg-status-bars" aria-hidden="true">
                      <div className="msg-status-bar" />
                      <div className="msg-status-bar-mid" />
                      <div className="msg-status-bar-faint" />
                    </div>
                  </div>
                ) : (
                  <div className="item-agent" data-kind="agent" />
                )}
                {item.text ? (
                  <div className="msg-actions">
                    <button
                      type="button"
                      className="msg-action-btn"
                      title="Copy"
                      onClick={() => {
                        void navigator.clipboard?.writeText(item.text);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
              </div>
            </FadeContent>
          );
        }
        if (item.kind === "thought") {
          return (
            <FadeContent key={item.id} className="msg-agent-wrap" durationMs={300}>
              <ThoughtWidget item={item} sessionStatus={status} />
            </FadeContent>
          );
        }
        if (item.kind === "tool") {
          const card = toolCalls[item.toolCallId];
          return (
            <FadeContent key={item.id} className="msg-agent-wrap" durationMs={340}>
              <ToolCardView card={card} toolCallId={item.toolCallId} />
            </FadeContent>
          );
        }
        return (
          <FadeContent key={item.id} className="msg-agent-wrap">
            <div className="item-error" data-kind="error">
              {item.message}
            </div>
          </FadeContent>
        );
      })}
    </div>
  );
}
