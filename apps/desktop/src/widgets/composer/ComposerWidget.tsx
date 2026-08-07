/**
 * Composer state container.
 * State is computed in useComposerWidget; this component only assembles the result into UI.
 */

import { ComposerSuggestionListView } from "./ComposerSuggestionListView";
import { modeLabel, useComposerWidget } from "./useComposerWidget";

/**
 * Renders the sendable textarea, mode controls, and `@`/`/` completion.
 * @returns Composer bound to the real live bridge; when the bridge is unavailable send fails and the draft is kept.
 */
export function ComposerWidget() {
  const widget = useComposerWidget();
  const placeholder =
    widget.timelineLength > 0 ? "Continue the conversation…" : "Ask Grok anything";

  return (
    <div className="composer-dock">
      <div className="composer-dock-inner">
        <div className="composer">
          {widget.isMenuOpen ? (
            <ComposerSuggestionListView
              suggestions={widget.suggestions}
              activeIndex={widget.activeIndex}
              emptyLabel={widget.emptyLabel}
              onPick={widget.pickSuggestion}
            />
          ) : null}
          <textarea
            ref={widget.textareaRef}
            className="composer-input"
            placeholder={placeholder}
            value={widget.draft}
            disabled={!widget.canType || widget.status === "waiting_permission"}
            rows={2}
            aria-controls={
              widget.isMenuOpen ? "composer-suggestions" : undefined
            }
            aria-expanded={widget.isMenuOpen}
            aria-activedescendant={
              widget.suggestions.length > 0
                ? `composer-suggestion-${widget.activeIndex}`
                : undefined
            }
            onChange={widget.handleDraftChange}
            onSelect={widget.handleSelection}
            onKeyDown={widget.handleKeyDown}
          />
          <div className="composer-bar">
            <div className="composer-bar-left">
              <button
                type="button"
                className="composer-chip-btn"
                onClick={widget.setMode}
                title="Switch Ask / Plan / Build"
              >
                {modeLabel(widget.mode)}
              </button>
              <span className="composer-model-label">
                {widget.model || "grok"} · live
              </span>
            </div>
            <div className="composer-bar-right">
              <span className="composer-hint">@ files · / commands · Enter to send</span>
              {widget.streaming ? (
                <button
                  type="button"
                  className="composer-stop"
                  onClick={widget.cancelTurn}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="composer-send"
                  disabled={!widget.canSend}
                  onClick={widget.submitDraft}
                  title="Send"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
        {widget.sendHint ? (
          <p className="composer-hint composer-hint-warn" role="status">
            {widget.sendHint}
          </p>
        ) : null}
        <p className="composer-hint composer-hint-footer">
          {widget.connectionMode === "live-bridge"
            ? "Real grok-build · @ reads files from the current workspace"
            : "Waiting for bridge (npm run bridge)"}
        </p>
      </div>
    </div>
  );
}
