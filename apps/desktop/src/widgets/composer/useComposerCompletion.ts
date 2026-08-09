/**
 * Composer completion interaction state.
 * Owns local draft, caret, and real bridge file queries only; does not connect Zustand or send prompts.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { AvailableCommand } from "@grok-desktop/acp-core";
import {
  sealCompletedMentions,
  snapCaretToMentionEdge,
} from "@/lib/mentionTokens";
import {
  createCommandSuggestions,
  getComposerEmptyLabel,
  createMentionSuggestions,
  findComposerTrigger,
  replaceComposerTrigger,
  type ComposerSuggestion,
  type ComposerWorkspaceEntry,
} from "./composerCompletion";

type ComposerCompletionConfig = {
  commands: AvailableCommand[];
  listWorkspaceEntries?: (query: string) => Promise<ComposerWorkspaceEntry[]>;
};

/**
 * Local state and behavior for the `@` file and `/skill` menus.
 * @param config Current agent command snapshot and real bridge file reader; when the reader is missing only connection hints are shown.
 * @returns Draft, menu state, and event handlers for the textarea.
 */
export function useComposerCompletion(config: ComposerCompletionConfig) {
  const { commands, listWorkspaceEntries } = config;
  /** High-frequency draft belongs only to Composer, not global session state. */
  const [draft, setDraft] = useState("");
  /** Caret position decides plain typing vs `@` file completion vs `/` command completion. */
  const [caret, setCaret] = useState(0);
  /** Result of the latest real bridge file scan. */
  const [workspaceEntries, setWorkspaceEntries] = useState<
    ComposerWorkspaceEntry[]
  >([]);
  /** Explicit menu feedback while a file scan is in flight. */
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  /** Keeps a failure state when the bridge does not answer file indexing, so protocol/connection issues are not disguised as an empty directory. */
  const [hasWorkspaceLoadError, setHasWorkspaceLoadError] = useState(false);
  /** Keyboard-controlled highlight index inside the menu. */
  const [activeIndex, setActiveIndex] = useState(0);
  /** Escape dismisses the menu for the current token; further edits reopen it. */
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(
    null,
  );
  /** Textarea selection is restored only after React commits the replacement, avoiding imperative render-attribute writes. */
  const pendingCaretRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trigger = useMemo(
    () => findComposerTrigger(draft, caret),
    [draft, caret],
  );
  const triggerKey = trigger
    ? `${trigger.kind}:${trigger.start}:${trigger.end}:${trigger.query}`
    : null;
  const suggestions = useMemo(() => {
    if (!trigger) {return [];}
    if (trigger.kind === "command") {
      return createCommandSuggestions(commands, trigger.query);
    }
    return createMentionSuggestions(workspaceEntries, trigger.query);
  }, [commands, trigger, workspaceEntries]);
  const isMenuOpen = Boolean(trigger && dismissedTriggerKey !== triggerKey);
  const emptyLabel = getComposerEmptyLabel(
    trigger?.kind,
    isLoadingEntries,
    Boolean(listWorkspaceEntries),
    hasWorkspaceLoadError,
  );
  const activeSuggestion = suggestions[activeIndex];

  useEffect(() => {
    const mentionQuery = trigger?.kind === "mention" ? trigger.query : null;
    const canLoadEntries = mentionQuery !== null && Boolean(listWorkspaceEntries);
    const delay = 120;
    let active = true;

    if (!canLoadEntries || !listWorkspaceEntries) {
      setIsLoadingEntries(false);
      setHasWorkspaceLoadError(false);
      return () => undefined;
    }

    setHasWorkspaceLoadError(false);
    const timer = setTimeout(() => {
      setIsLoadingEntries(true);
      void listWorkspaceEntries(mentionQuery)
        .then(
          (entries) => {
            if (active) {
              setWorkspaceEntries(entries);
            }
          },
          () => {
            if (active) {
              setWorkspaceEntries([]);
              setHasWorkspaceLoadError(true);
            }
          },
        )
        .finally(() => {
          if (active) {
            setIsLoadingEntries(false);
          }
        });
    }, delay);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [listWorkspaceEntries, trigger?.kind, trigger?.query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [triggerKey]);

  useLayoutEffect(() => {
    const pendingCaret = pendingCaretRef.current;
    const textarea = textareaRef.current;

    if (pendingCaret === null || !textarea) {return;}
    pendingCaretRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pendingCaret, pendingCaret);
  }, [draft]);

  /** Pick a candidate with mouse or keyboard and restore the logical caret after replacement. */
  const pickSuggestion = (suggestion: ComposerSuggestion) => {
    const currentTrigger = findComposerTrigger(draft, caret);
    if (!currentTrigger) {return;}

    const replacement = replaceComposerTrigger(
      draft,
      currentTrigger,
      suggestion.value,
    );
    pendingCaretRef.current = replacement.caret;
    setDraft(replacement.value);
    setCaret(replacement.caret);
    setDismissedTriggerKey(null);
  };

  /**
   * Track input and selection; seal finished tokens into zero-width marks so
   * hidden triggers do not leave gaps; reopen the menu on any new edit.
   */
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextCaret = event.target.selectionStart;
    const sealed = sealCompletedMentions(event.target.value, nextCaret);
    setDraft(sealed.value);
    setCaret(sealed.caret);
    setDismissedTriggerKey(null);
    if (sealed.value !== event.target.value) {
      pendingCaretRef.current = sealed.caret;
    }
  };

  /**
   * Recompute the trigger when the user moves the caret so completion works
   * inside existing text. Collapsed carets that land inside a mention snap to
   * the nearer edge so committed tokens stay atomic.
   */
  const handleSelection = (
    event: { currentTarget: HTMLTextAreaElement },
  ) => {
    const ta = event.currentTarget;
    const rawStart = ta.selectionStart;
    const rawEnd = ta.selectionEnd;
    if (rawStart !== rawEnd) {
      setCaret(rawStart);
      return;
    }
    const snapped = snapCaretToMentionEdge(draft, rawStart);
    if (snapped !== rawStart) {
      ta.setSelectionRange(snapped, snapped);
    }
    setCaret(snapped);
  };

  /** Cycle the keyboard highlight forward; empty lists keep the prior index. */
  const selectNextSuggestion = () => {
    if (suggestions.length > 0) {
      setActiveIndex((index) => (index + 1) % suggestions.length);
    }
  };

  /** Cycle the keyboard highlight backward; empty lists keep the prior index. */
  const selectPreviousSuggestion = () => {
    if (suggestions.length > 0) {
      setActiveIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    }
  };

  /** Close the menu for the current trigger without deleting the typed `@` or `/`. */
  const dismissMenu = () => setDismissedTriggerKey(triggerKey);

  /**
   * Replace the draft and restore the caret after React commits (atomic delete,
   * programmatic inserts). Missing caret leaves the browser selection alone.
   * @param value Next draft string.
   * @param caret Collapsed caret index to apply after paint.
   */
  const setDraftWithCaret = (value: string, caret: number) => {
    pendingCaretRef.current = caret;
    setDraft(value);
    setCaret(caret);
  };

  return {
    activeIndex,
    activeSuggestion,
    draft,
    emptyLabel,
    handleDraftChange,
    handleSelection,
    isMenuOpen,
    pickSuggestion,
    selectNextSuggestion,
    selectPreviousSuggestion,
    dismissMenu,
    setDraft,
    setDraftWithCaret,
    suggestions,
    textareaRef,
  };
}
