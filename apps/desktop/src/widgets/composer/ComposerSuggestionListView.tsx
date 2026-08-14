/**
 * Pure presentation layer for the Composer completion menu.
 * Does not read the store or own focus; selection, keyboard, and pointer
 * highlight are fully orchestrated by ComposerWidget.
 * Panel height follows the current candidate count (capped by CSS max-h-80); no min-height ratchet.
 * The active row callback-ref keeps ArrowUp/Down inside that port.
 */

import cs from "classnames";
import { MentionIconView } from "@/widgets/shared";
import type { ComposerSuggestion } from "./composerCompletion";
import { revealActiveSuggestion } from "./composerSuggestionScroll";

type ComposerSuggestionListViewProps = {
  suggestions: ComposerSuggestion[];
  activeIndex: number;
  emptyLabel: string;
  onPick: (suggestion: ComposerSuggestion) => void;
  /**
   * Moves the shared highlight to this row so hover and Enter stay in sync.
   * Required: without it the keyboard index stays put while the pointer moves.
   */
  onHighlight: (index: number) => void;
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
 * Shell height tracks the current suggestion count (content-sized); CSS `max-h-80` caps long lists.
 * Active-row ref calls revealActiveSuggestion so a wrapped last/first row still lands on screen.
 * @param props Candidates, keyboard/pointer highlight, pick, and hover sync.
 * @returns Menu view for the textarea to associate via aria-controls.
 */
export function ComposerSuggestionListView(
  props: ComposerSuggestionListViewProps,
) {
  const { suggestions, activeIndex, emptyLabel, onPick, onHighlight } = props;

  if (suggestions.length === 0) {
    return (
      <div
        className="composer-suggestions"
        id="composer-suggestions"
        role="status"
      >
        <div className="composer-suggestions-content">
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
    >
      <div className="composer-suggestions-content">
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
              ref={index === activeIndex ? revealActiveSuggestion : undefined}
              type="button"
              className={optionClassName}
              role="option"
              aria-selected={index === activeIndex}
              title={tooltip}
              onMouseEnter={() => onHighlight(index)}
              onMouseMove={() => onHighlight(index)}
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
