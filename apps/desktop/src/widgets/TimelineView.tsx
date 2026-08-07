/**
 * Chat canvas: ordered stream of user / agent / thought / tool / error.
 * User bubbles align right; agent text + action row align left (design shell).
 * Tool bodies always read from the shared toolCalls map (patch-merge target).
 */

import { useSessionStore } from "../store/sessionStore";
import { ThoughtWidget, ToolCardView } from "@/widgets/timeline";

/**
 * Renders the ordered ACP timeline and hands Thought/Tool items to their display units.
 * @returns An empty-state guide when the session has no events, or the live chat canvas in event order.
 */
export function TimelineView() {
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const status = useSessionStore((s) => s.session.status);

  if (timeline.length === 0) {
    return (
      <div className="timeline">
        <div className="empty">
          <p>Ready</p>
          <p>Describe a task for live grok-build.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline" data-status={status}>
      {timeline.map((item, index) => {
        if (item.kind === "user") {
          const text = item.blocks
            .map((b) => (b.type === "text" ? b.text : b.type))
            .join("");
          return (
            <div key={item.id} className="msg-user-wrap">
              <div className="item-user" data-kind="user">
                {text}
              </div>
            </div>
          );
        }
        if (item.kind === "agent") {
          return (
            <div key={item.id} className="msg-agent-wrap">
              <div className="msg-agent-inner">
                <div className="item-agent" data-kind="agent">
                  {item.text}
                  {status === "streaming" && index === timeline.length - 1
                    ? " ▌"
                    : ""}
                </div>
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
            </div>
          );
        }
        if (item.kind === "thought") {
          return (
            <div key={item.id} className="msg-agent-wrap">
              <ThoughtWidget item={item} sessionStatus={status} />
            </div>
          );
        }
        if (item.kind === "tool") {
          const card = toolCalls[item.toolCallId];
          return (
            <div key={item.id} className="msg-agent-wrap">
              <ToolCardView card={card} toolCallId={item.toolCallId} />
            </div>
          );
        }
        return (
          <div key={item.id} className="msg-agent-wrap">
            <div className="item-error" data-kind="error">
              {item.message}
            </div>
          </div>
        );
      })}
    </div>
  );
}
