/**
 * Composer state container.
 * State is computed in useComposerWidget; this component only assembles the result into UI.
 */

import { ClickSpark, StarBorder } from "@/components/react-bits";
import { ComposerInputView } from "./ComposerInputView";
import { ComposerModelMenuView } from "./ComposerModelMenuView";
import { ComposerModeControlView } from "./ComposerModeControlView";
import { ComposerSuggestionListView } from "./ComposerSuggestionListView";
import { useComposerWidget } from "./useComposerWidget";

/**
 * Renders the sendable textarea, mode controls, model/thinking menu, and `@`/`/` completion.
 * @returns Composer bound to the real live bridge; when the bridge is unavailable send fails and the draft is kept.
 */
export function ComposerWidget() {
  const widget = useComposerWidget();
  const placeholder =
    widget.timelineLength > 0
      ? "Continue the conversation…"
      : "Ask Grok anything";

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
          <ComposerInputView
            draft={widget.draft}
            placeholder={placeholder}
            disabled={!widget.canType || widget.status === "waiting_permission"}
            textareaRef={widget.textareaRef}
            ariaControls={
              widget.isMenuOpen ? "composer-suggestions" : undefined
            }
            ariaExpanded={widget.isMenuOpen}
            ariaActivedescendant={
              widget.suggestions.length > 0
                ? `composer-suggestion-${widget.activeIndex}`
                : undefined
            }
            attachments={widget.attachments}
            dragOver={widget.dragOver}
            onChange={widget.handleDraftChange}
            onSelect={widget.handleSelection}
            onKeyDown={widget.handleKeyDown}
            onScroll={widget.handleInputScroll}
            onPaste={widget.handlePaste}
            onDragOver={widget.handleDragOver}
            onDragLeave={widget.handleDragLeave}
            onDrop={widget.handleDrop}
            onRemoveAttachment={widget.removeAttachment}
          />
          <div className="composer-bar">
            <div className="composer-bar-left">
              <ComposerModeControlView
                mode={widget.mode}
                pendingMode={widget.pendingMode}
                options={widget.modeOptions}
                open={widget.modeMenuOpen}
                onToggle={widget.toggleModeMenu}
                onSelect={widget.selectMode}
                onClose={widget.closeModeMenu}
              />
              <button
                type="button"
                className="composer-chip-btn"
                title="Voice dictation (Web Speech API)"
                onClick={widget.startDictation}
              >
                Mic
              </button>
            </div>
            <div className="composer-bar-right">
              <ComposerModelMenuView
                open={widget.menuOpen}
                panel={widget.menuPanel}
                modelId={widget.model}
                modelLabel={widget.modelLabel}
                effort={widget.effort}
                effortLabel={widget.effortLabel}
                models={widget.models}
                thinkingOptions={widget.thinkingOptions}
                onToggle={widget.toggleMenu}
                onOpenPanel={widget.openPanel}
                onSelectModel={widget.selectModel}
                onSelectEffort={widget.selectEffort}
                onReset={widget.resetControls}
                onClose={widget.closeMenu}
              />
              {widget.streaming ? (
                <button
                  type="button"
                  className="composer-stop"
                  onClick={widget.cancelTurn}
                >
                  Stop
                </button>
              ) : (
                <ClickSpark sparkCount={10} sparkRadius={14}>
                  <StarBorder
                    className="composer-send-star"
                    disabled={!widget.canSend}
                    onClick={widget.submitDraft}
                    title="Send · Enter"
                    speed="4s"
                  >
                    <span className="composer-send" aria-hidden="true">
                      ↑
                    </span>
                  </StarBorder>
                </ClickSpark>
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
            ? "Enter to send · ⇧Tab mode · @ files · / commands"
            : "Waiting for bridge (npm run bridge)"}
        </p>
      </div>
    </div>
  );
}
