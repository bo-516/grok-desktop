/**
 * "Run in a new worktree" block above the composer card.
 * Stateless: the widget owns the checkbox, the name, and the base ref.
 * Shown only for a new-chat draft in a git project while the bridge is up.
 */

import { Checkbox } from "@/components/ui/Checkbox";

/** Props for {@link WorktreeChatOptionView}. */
export type WorktreeChatOptionViewProps = {
  /** Checkbox state. False hides the name and ref fields. */
  enabled: boolean;
  /** Optional worktree name. Empty lets grok generate one. */
  name: string;
  /** Optional base ref. Empty bases on HEAD plus uncommitted changes. */
  refValue: string;
  /** Placeholder for the ref field — the checkout's current branch. */
  branchPlaceholder: string;
  /** Name validation message. Empty hides it. */
  nameError: string;
  /** Ref validation message. Empty hides it. */
  refError: string;
  /**
   * Toggle the option. A true value with empty fields still creates.
   * @param next Next checked state.
   */
  onEnabledChange: (next: boolean) => void;
  /**
   * Name keystrokes. Not written to the session store.
   * @param next Current input value.
   */
  onNameChange: (next: string) => void;
  /**
   * Ref keystrokes. Not written to the session store.
   * @param next Current input value.
   */
  onRefChange: (next: string) => void;
};

/**
 * Composer option for starting the next chat in its own worktree.
 * Invalid name or ref text is shown under the fields; the widget withholds
 * the start request until both tokens are safe.
 * @param props Checkbox, fields, and the three change handlers.
 * @returns The option block. The widget returns null when it should hide.
 */
export function WorktreeChatOptionView(props: WorktreeChatOptionViewProps) {
  const {
    enabled,
    name,
    refValue,
    branchPlaceholder,
    nameError,
    refError,
    onEnabledChange,
    onNameChange,
    onRefChange,
  } = props;
  return (
    <div className="worktree-opt">
      <Checkbox
        label="Run in a new worktree"
        description="Starts this chat on its own checkout so it does not share uncommitted files with other chats."
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
      />
      {enabled ? (
        <div className="worktree-opt-fields">
          <input
            className="worktree-opt-input"
            type="text"
            value={name}
            placeholder="Optional name"
            aria-label="Worktree name"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onNameChange(event.target.value)}
          />
          <input
            className="worktree-opt-input"
            type="text"
            value={refValue}
            placeholder={branchPlaceholder || "HEAD"}
            aria-label="Base ref"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onRefChange(event.target.value)}
          />
        </div>
      ) : null}
      {enabled && (nameError || refError) ? (
        <p className="worktree-opt-error">{nameError || refError}</p>
      ) : null}
    </div>
  );
}
