/**
 * Composer state container.
 * Most state is computed in useComposerWidget; weekly remaining and the
 * mid-turn follow-up queue are sibling hooks so that file stays under the
 * line cap. This component assembles the UI.
 * Status footer is always mounted (one row) and driven by resolveComposerStatus.
 * The live-turn strip sits above the card (outside the transcript scroller)
 * so Thinking / Responding cannot paint through the streaming answer.
 * Left bar includes a Codex-style + attach control that opens the image file picker.
 * The hidden file input lives outside the card flex so open/focus never jitters height.
 */

import cs from "classnames";
import { Plus } from "lucide-react";
import { ClickSpark, StarBorder } from "@/components/react-bits";
import { ProjectSwitcherWidget } from "@/widgets/project";
import { TurnStatusWidget } from "@/widgets/turnStatus";
import { ComposerContextUsageView } from "./ComposerContextUsageView";
import { ComposerWeeklyUsageView } from "./ComposerWeeklyUsageView";
import { useWeeklyUsageDisplay } from "./useWeeklyUsageDisplay";
import { ComposerInputView } from "./ComposerInputView";
import { ComposerModelMenuView } from "./ComposerModelMenuView";
import { ComposerModeControlView } from "./ComposerModeControlView";
import { ComposerQueueView } from "./ComposerQueueView";
import { ComposerSuggestionListView } from "./ComposerSuggestionListView";
import { resolveComposerStatus } from "./composerStatus";
import { useComposerQueue } from "./useComposerQueue";
import { useComposerWidget } from "./useComposerWidget";

/**
 * Renders the sendable textarea, project switcher, mode controls, model menu,
 * and `@`/`/` completion. Project is session context (next to the input), not
 * the left rail.
 * @returns Composer bound to the real live bridge; when the bridge is unavailable send fails and the draft is kept.
 */
export function ComposerWidget() {
  const widget = useComposerWidget();
  /** Weekly remaining lives here so useComposerWidget stays under the line cap. */
  const weeklyUsageDisplay = useWeeklyUsageDisplay();
  /**
   * Mid-turn follow-ups sit above the composer card (Codex / Claude queue
   * panel) with Send now / Edit / Cancel. Draft writes stay on the completion
   * hook via this adapter.
   */
  const queue = useComposerQueue({
    draft: widget.draft,
    setDraftWithCaret: widget.setDraftWithCaret,
    textareaRef: widget.textareaRef,
  });
  let idlePlaceholder = "Ask Grok anything";
  if (widget.viewingSubagent) {
    idlePlaceholder =
      "Subagent session is read-only · return to the parent to continue";
  } else if (widget.timelineLength > 0) {
    idlePlaceholder = "Continue the conversation…";
  }
  /** Listening owns the field chrome so Mic state and the textarea stay in sync. */
  const placeholder = widget.dictating ? "Listening…" : idlePlaceholder;
  /** Single reserved status row — text/tone only; never mounts/unmounts. */
  const statusLine = resolveComposerStatus({
    connectionMode: widget.connectionMode,
    dictating: widget.dictating,
    notice: widget.notice,
  });

  return (
    <div className="composer-dock">
      <div className="composer-dock-inner">
        {/*
          Layout-inert multi-image picker — kept outside .composer flex so it
          never participates in gap / card height (opened by the + control).
        */}
        <input
          ref={widget.fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="composer-attach-input"
          tabIndex={-1}
          aria-hidden="true"
          onChange={widget.handleFileInputChange}
        />
        {/*
          Live-turn strip: outside the timeline scroller so a sticky pill
          cannot overlay / punch through the answer. Renders null when idle.
        */}
        <TurnStatusWidget />
        {/*
          Codex / Claude: follow-ups sit above the composer as their own
          surface — never inside the input card (that reads as one field).
        */}
        <ComposerQueueView
          items={queue.items}
          onSendNow={queue.sendNow}
          onEdit={queue.edit}
          onCancel={queue.cancel}
        />
        <div className="composer">
          {widget.isMenuOpen ? (
            <ComposerSuggestionListView
              suggestions={widget.suggestions}
              activeIndex={widget.activeIndex}
              emptyLabel={widget.emptyLabel}
              onPick={widget.pickSuggestion}
              onHighlight={widget.highlightSuggestion}
            />
          ) : null}
          <ComposerInputView
            draft={widget.draft}
            placeholder={placeholder}
            disabled={!widget.canType || widget.status === "waiting_permission"}
            listening={widget.dictating}
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
            onCompositionStart={widget.handleCompositionStart}
            onCompositionEnd={widget.handleCompositionEnd}
            onScroll={widget.handleInputScroll}
            onPaste={widget.handlePaste}
            onDragOver={widget.handleDragOver}
            onDragLeave={widget.handleDragLeave}
            onDrop={widget.handleDrop}
            onRemoveAttachment={widget.removeAttachment}
          />
          <div className="composer-bar">
            <div className="composer-bar-left">
              <button
                type="button"
                className="composer-icon-btn composer-attach-btn"
                title="Attach images (or drag & drop / paste)"
                aria-label="Attach images"
                disabled={
                  !widget.canType || widget.status === "waiting_permission"
                }
                onClick={widget.openFilePicker}
              >
                <Plus className="composer-attach-icon" aria-hidden="true" />
              </button>
              <ProjectSwitcherWidget />
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
                className={cs("composer-chip-btn", "composer-mic-chip", {
                  "composer-chip-btn-active": widget.dictating,
                })}
                title={
                  widget.dictating
                    ? "Stop voice dictation"
                    : "Voice dictation (Web Speech API)"
                }
                aria-pressed={widget.dictating}
                aria-label={
                  widget.dictating ? "Stop listening" : "Start voice dictation"
                }
                disabled={
                  !widget.canType || widget.status === "waiting_permission"
                }
                onClick={widget.toggleDictation}
              >
                <span
                  className={cs("composer-mic-dot", {
                    "composer-mic-dot-live": widget.dictating,
                  })}
                  aria-hidden="true"
                />
                {/* Fixed label — mic state is the pulse dot, not a wider "Listening" chip. */}
                Mic
              </button>
            </div>
            <div className="composer-bar-right">
              {/*
                Weekly remaining immediately left of the context pie
                (Settings → Appearance). Gated so a missing snapshot leaves no slot.
              */}
              {weeklyUsageDisplay ? (
                <ComposerWeeklyUsageView display={weeklyUsageDisplay} />
              ) : null}
              {/*
                Context pie left of the model chip (Settings → Appearance).
                Null until occupancy is known — do not reserve a 0% disk.
                Mount plays composer-usage-reveal (Weekly slides, then fade).
              */}
              {widget.contextUsageDisplay ? (
                <ComposerContextUsageView display={widget.contextUsageDisplay} />
              ) : null}
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
        <p
          className={cs("composer-status", {
            "composer-status-warn": statusLine.tone === "warn",
            "composer-status-info": statusLine.tone === "info",
            "composer-status-neutral": statusLine.tone === "neutral",
          })}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={statusLine.text}
        >
          {statusLine.text}
        </p>
      </div>
    </div>
  );
}
