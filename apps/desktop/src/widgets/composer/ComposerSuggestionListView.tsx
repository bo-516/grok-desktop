/**
 * Pure presentation layer for the Composer completion menu.
 * Does not read the store or own focus; selection and keyboard state are fully orchestrated by ComposerWidget.
 * Local min-height ratchet is presentation-only (no store) so filter updates do not drop row text.
 */

import cs from "classnames";
import { useLayoutEffect, useRef, useState } from "react";
import { MentionIconView } from "@/widgets/shared";
import type { ComposerSuggestion } from "./composerCompletion";

type ComposerSuggestionListViewProps = {
  suggestions: ComposerSuggestion[];
  activeIndex: number;
  emptyLabel: string;
  onPick: (suggestion: ComposerSuggestion) => void;
};

/**
 * Maps a completion kind to a short UI badge label.
 * @param kind Suggestion kind.
 * @returns Badge copy, or empty for plain commands (every-row "Command" is noise).
 */
function suggestionKindLabel(kind: ComposerSuggestion["kind"]): string {
  if (kind === "file") {
    return "File";
  }
  if (kind === "directory") {
    return "Folder";
  }
  if (kind === "skill") {
    return "Skill";
  }
  return "";
}

/**
 * Color class for the kind pill (file / folder / skill).
 * @param kind Suggestion kind.
 */
function suggestionKindClass(kind: ComposerSuggestion["kind"]): string {
  if (kind === "file") {
    return "composer-suggestion-kind-file";
  }
  if (kind === "directory") {
    return "composer-suggestion-kind-directory";
  }
  if (kind === "skill") {
    return "composer-suggestion-kind-skill";
  }
  return "composer-suggestion-kind-command";
}

/**
 * Icon color class matching the chip tint for the row glyph.
 * @param kind Suggestion kind.
 * @returns Token-backed text color class; skills reuse the command tint.
 */
function suggestionIconClass(kind: ComposerSuggestion["kind"]): string {
  if (kind === "file") {
    return "text-mention-file";
  }
  if (kind === "directory") {
    return "text-mention-dir";
  }
  if (kind === "skill") {
    return "text-mention-skill";
  }
  return "text-mention-command";
}

/**
 * Label color class matching mention tint for the suggestion title.
 * @param kind Suggestion kind.
 */
function suggestionLabelClass(kind: ComposerSuggestion["kind"]): string {
  if (kind === "file") {
    return "composer-suggestion-label text-mention-file";
  }
  if (kind === "directory") {
    return "composer-suggestion-label text-mention-dir";
  }
  if (kind === "skill") {
    return "composer-suggestion-label text-mention-skill";
  }
  return "composer-suggestion-label text-mention-command";
}

/**
 * Trim agent input hints for the mono usage line.
 * @param hint Raw ACP `input.hint`.
 * @returns Display string, or null when empty.
 */
function formatInputHint(hint: string | undefined): string | null {
  const trimmed = hint?.trim() ?? "";
  return trimmed || null;
}

/**
 * Build a hover/title tooltip that keeps full agent copy when the row truncates.
 * @param suggestion Candidate currently rendered.
 * @returns Multi-line title text, or undefined when only the label exists.
 */
/** Title for the gitignored secondary badge — explains why we embed on send. */
const GITIGNORED_BADGE_TITLE =
  "grok 的工具默认看不到此文件，发送时会附带完整内容";

/**
 * Caps the open-cycle height ratchet at the menu max height (`max-h-80` = 20rem).
 * Without this, min-height can win over max-height in CSS and grow past the scrollport.
 */
const SUGGESTIONS_MAX_HEIGHT_PX = 320;

function suggestionTooltip(suggestion: ComposerSuggestion): string | undefined {
  const parts: string[] = [];
  const description = suggestion.description?.trim() ?? "";
  const hint = formatInputHint(suggestion.inputHint);
  if (description) {
    parts.push(description);
  }
  if (hint) {
    parts.push(hint);
  }
  if (suggestion.ignored === true) {
    parts.push(GITIGNORED_BADGE_TITLE);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Renders the candidate list shared by `@` and `/`.
 * Each row is a non-shrinking block: title, description, and args hint stay on separate lines.
 * While the menu stays mounted, min-height only grows so bottom-anchored filter shrinks
 * do not drop remaining labels toward the input (the visual "text jitter" while typing).
 * @param props Candidates, keyboard highlight, and pick callback.
 * @returns Menu view for the textarea to associate via aria-controls.
 */
export function ComposerSuggestionListView(
  props: ComposerSuggestionListViewProps,
) {
  const { suggestions, activeIndex, emptyLabel, onPick } = props;
  /** Measures the row stack only — outer minHeight must not inflate this reading. */
  const contentRef = useRef<HTMLDivElement>(null);
  /**
   * Ratcheted content height in px for this open cycle.
   * Reset automatically when the parent unmounts the menu (isMenuOpen → false).
   */
  const [minHeightPx, setMinHeightPx] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const measured = Math.min(content.offsetHeight, SUGGESTIONS_MAX_HEIGHT_PX);
    setMinHeightPx((prev) => (measured > prev ? measured : prev));
  }, [suggestions, emptyLabel]);

  /** Layout-only minHeight; never carries color (color rules forbid paint styles). */
  const shellStyle =
    minHeightPx > 0 ? ({ minHeight: minHeightPx } as const) : undefined;

  if (suggestions.length === 0) {
    return (
      <div
        className="composer-suggestions"
        id="composer-suggestions"
        role="status"
        style={shellStyle}
      >
        <div ref={contentRef} className="composer-suggestions-content">
          <p className="composer-suggestions-empty">{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="composer-suggestions"
      id="composer-suggestions"
      role="listbox"
      style={shellStyle}
    >
      <div ref={contentRef} className="composer-suggestions-content">
        {suggestions.map((suggestion, index) => {
          const kindLabel = suggestionKindLabel(suggestion.kind);
          const optionClassName = cs("composer-suggestion", {
            "composer-suggestion-active": index === activeIndex,
          });
          const kindClass = cs(
            "composer-suggestion-kind",
            suggestionKindClass(suggestion.kind),
          );
          const labelClass = suggestionLabelClass(suggestion.kind);
          const description = suggestion.description?.trim() || "";
          const inputHint = formatInputHint(suggestion.inputHint);
          const tooltip = suggestionTooltip(suggestion);

          return (
            <button
              key={suggestion.id}
              id={`composer-suggestion-${index}`}
              type="button"
              className={optionClassName}
              role="option"
              aria-selected={index === activeIndex}
              title={tooltip}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(suggestion)}
            >
              <span className="composer-suggestion-main">
                <span className="composer-suggestion-title-row">
                  {/* Same icon funnel as the rendered chips, so a row and the chip
                      it inserts are recognizably the same thing. */}
                  <MentionIconView
                    kind={suggestion.kind}
                    className={cs(
                      "composer-suggestion-icon",
                      suggestionIconClass(suggestion.kind),
                    )}
                  />
                  <span className={labelClass}>{suggestion.label}</span>
                  {kindLabel ? (
                    <span className={kindClass}>{kindLabel}</span>
                  ) : null}
                  {suggestion.ignored === true ? (
                    <span
                      className="composer-suggestion-kind composer-suggestion-kind-gitignored"
                      title={GITIGNORED_BADGE_TITLE}
                    >
                      gitignored
                    </span>
                  ) : null}
                </span>
                {description ? (
                  <span className="composer-suggestion-detail">
                    {description}
                  </span>
                ) : null}
                {inputHint ? (
                  <span className="composer-suggestion-hint">{inputHint}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
