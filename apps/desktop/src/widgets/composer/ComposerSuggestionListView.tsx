/**
 * Pure presentation layer for the Composer completion menu.
 * Does not read the store or own focus; selection and keyboard state are fully orchestrated by ComposerWidget.
 */

import cs from "classnames";
import type { ComposerSuggestion } from "./composerCompletion";

type ComposerSuggestionListViewProps = {
  suggestions: ComposerSuggestion[];
  activeIndex: number;
  emptyLabel: string;
  onPick: (suggestion: ComposerSuggestion) => void;
};

/**
 * Maps a completion kind to a short UI badge label (avoids duplicating description text).
 * @param kind Suggestion kind; unknown values are returned as-is.
 * @returns Badge copy.
 */
function suggestionKindLabel(kind: ComposerSuggestion["kind"]): string {
  if (kind === "file") {return "File";}
  if (kind === "directory") {return "Folder";}
  if (kind === "skill") {return "Skill";}
  if (kind === "command") {return "Command";}
  return kind;
}

/**
 * Renders the candidate list shared by `@` and `/`.
 * @param props Candidates, keyboard highlight, and pick callback; empty lists show caller-provided status copy.
 * @returns Stateless menu view for the textarea to associate via aria-controls.
 */
export function ComposerSuggestionListView(
  props: ComposerSuggestionListViewProps,
) {
  const { suggestions, activeIndex, emptyLabel, onPick } = props;

  if (suggestions.length === 0) {
    return (
      <div className="composer-suggestions" id="composer-suggestions" role="status">
        <p className="composer-suggestions-empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="composer-suggestions" id="composer-suggestions" role="listbox">
      {suggestions.map((suggestion, index) => {
        const kindLabel = suggestionKindLabel(suggestion.kind);
        const optionClassName = cs("composer-suggestion", {
          "composer-suggestion-active": index === activeIndex,
        });
        const detail = suggestion.inputHint
          ? `${suggestion.description ?? ""} ${suggestion.inputHint}`.trim()
          : suggestion.description;

        return (
          <button
            key={suggestion.id}
            id={`composer-suggestion-${index}`}
            type="button"
            className={optionClassName}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(suggestion)}
          >
            <span className="composer-suggestion-main">
              <span className="composer-suggestion-label">{suggestion.label}</span>
              {detail ? (
                <span className="composer-suggestion-detail">{detail}</span>
              ) : null}
            </span>
            <span className="composer-suggestion-kind">{kindLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
