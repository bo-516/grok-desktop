/**
 * Pure presentation layer for the Composer completion menu.
 * Does not read the store or own focus; selection and keyboard state are fully orchestrated by ComposerWidget.
 */

import cs from "classnames";
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
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Renders the candidate list shared by `@` and `/`.
 * Each row is a non-shrinking block: title, description, and args hint stay on separate lines.
 * @param props Candidates, keyboard highlight, and pick callback.
 * @returns Stateless menu view for the textarea to associate via aria-controls.
 */
export function ComposerSuggestionListView(
  props: ComposerSuggestionListViewProps,
) {
  const { suggestions, activeIndex, emptyLabel, onPick } = props;

  if (suggestions.length === 0) {
    return (
      <div
        className="composer-suggestions"
        id="composer-suggestions"
        role="status"
      >
        <p className="composer-suggestions-empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      className="composer-suggestions"
      id="composer-suggestions"
      role="listbox"
    >
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
              </span>
              {description ? (
                <span className="composer-suggestion-detail">{description}</span>
              ) : null}
              {inputHint ? (
                <span className="composer-suggestion-hint">{inputHint}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
