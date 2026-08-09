/**
 * Chat canvas: ordered stream of user / agent / thought / tool / error.
 * User bubbles align right; agent text + soft action row align left (Framer shell).
 * Tool bodies always read from the shared toolCalls map (patch-merge target).
 * Consecutive read/search tools collapse (F-TOOL-06).
 * Stick-to-bottom: selecting any session jumps instantly to latest (no glide);
 * clicking a message may smooth-scroll; live growth follows while pinned.
 */

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { useSessionStore } from "../store/sessionStore";
import { groupTimelineTools } from "../lib/toolGrouping";
import { groupTimelineThoughts } from "../lib/thoughtGrouping";
import { searchTimeline } from "../lib/timelineSearch";
import {
  StreamingMarkdownView,
  ThoughtWidget,
  ToolCardView,
} from "@/widgets/timeline";
import { ThoughtGroupView } from "./timeline/ThoughtGroupView";
import { ToolGroupView } from "./timeline/ToolGroupView";
import { useTimelineStickToBottom } from "./timeline/useTimelineStickToBottom";
import {
  BlurText,
  FadeContent,
  ShinyText,
} from "@/components/react-bits";
import { MentionTextView } from "@/widgets/shared";

/**
 * Fingerprint timeline growth so stick-to-bottom can follow streams without
 * deep-comparing the whole item list.
 * @param timeline Ordered session items (may be empty).
 * @param status Session run status (affects generating row).
 * @param lastAgentText Latest agent buffer (grows on each chunk while streaming).
 * @param toolStatusSig Compact tool status map so in-place tool updates still pin-follow.
 * @returns Stable-enough string key; empty timeline → status-only key.
 */
function timelineContentKey(
  timeline: TimelineItem[],
  status: string,
  lastAgentText: string,
  toolStatusSig: string,
): string {
  const last = timeline[timeline.length - 1];
  if (!last) {
    return `0:${status}`;
  }
  let tail: string | number = last.id;
  if (last.kind === "agent" || last.kind === "thought") {
    tail = last.text.length;
  }
  return `${timeline.length}:${last.kind}:${tail}:${status}:${lastAgentText.length}:${toolStatusSig}`;
}

/**
 * Renders the ordered ACP timeline and hands Thought/Tool items to their display units.
 * @returns An empty-state guide when the session has no events, or the live chat canvas in event order.
 */
export function TimelineView() {
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const status = useSessionStore((s) => s.session.status);
  const lastAgentText = useSessionStore((s) => s.session.lastAgentText);
  const sessionId = useSessionStore(
    (s) => s.viewingSessionId ?? s.session.id ?? s.activeSessionId,
  );
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);

  const units = useMemo(
    () => groupTimelineThoughts(groupTimelineTools(timeline, toolCalls)),
    [timeline, toolCalls],
  );
  const hits = useMemo(
    () => searchTimeline(timeline, findQuery),
    [timeline, findQuery],
  );
  const toolStatusSig = useMemo(
    () =>
      Object.keys(toolCalls)
        .sort()
        .map((id) => `${id}:${toolCalls[id]?.status ?? ""}`)
        .join(","),
    [toolCalls],
  );
  const contentKey = useMemo(
    () => timelineContentKey(timeline, status, lastAgentText, toolStatusSig),
    [timeline, status, lastAgentText, toolStatusSig],
  );
  const { scrollRef, handleScroll, scrollToBottom } = useTimelineStickToBottom({
    sessionId,
    contentKey,
  });

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

  /**
   * Clicking a message re-pins and scrolls to the latest turn.
   * Ignores interactive controls (buttons, links, inputs) so Copy / expand still work.
   * @param event bubble-phase click from the timeline surface.
   */
  const handleMessageClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("button, a, input, textarea, select, [role='button']")) {
      return;
    }
    // Only when the click landed on a message row, not empty padding / find bar.
    if (
      !target.closest(
        "[data-kind], .msg-user-wrap, .msg-agent-wrap, .item-user, .item-agent, .item-error",
      )
    ) {
      return;
    }
    scrollToBottom("smooth");
  };

  if (timeline.length === 0) {
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

  const activeHit = hits[findIndex];

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
        if (unit.type === "thought_group") {
          return (
            <FadeContent key={unit.id} className="msg-agent-wrap" durationMs={300}>
              <ThoughtGroupView unit={unit} />
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
                <AgentMessageBody
                  text={item.text}
                  showCursor={showCursor}
                />
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

/**
 * Agent bubble body: streamed markdown, generating shimmer, or empty shell.
 * @param props text from timeline item; showCursor only on last streaming row.
 */
function AgentMessageBody(props: {
  text: string;
  showCursor: boolean;
}) {
  if (props.text) {
    return (
      <div className="item-agent" data-kind="agent">
        <StreamingMarkdownView
          text={props.text}
          showCursor={props.showCursor}
        />
      </div>
    );
  }
  if (props.showCursor) {
    return (
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
    );
  }
  return <div className="item-agent" data-kind="agent" />;
}
