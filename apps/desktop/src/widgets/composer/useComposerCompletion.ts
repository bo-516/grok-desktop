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
import { snapCaretToMentionEdge } from "@/lib/mentionTokens";
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
  /**
   * Absolute session workspace root. Used to remap absolute `@` queries
   * (e.g. Finder paste `/Users/…/src/a.ts`) onto relative entry paths.
   * Empty / omitted leaves absolute remapping disabled.
   */
  workspace?: string;
};

/**
 * Structural equality for bridge workspace rows.
 * Avoids a React list rewrite (and the visible text jump) when a re-fetch returns the same index.
 * @param left Previous entries held in state.
 * @param right Fresh bridge payload.
 * @returns true when kind/path/ignored match in order.
 */
function workspaceEntriesEqual(
  left: ComposerWorkspaceEntry[],
  right: ComposerWorkspaceEntry[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.path !== b.path ||
      a.kind !== b.kind ||
      a.ignored !== b.ignored
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Local state and behavior for the `@` file and `/skill` menus.
 * @param config Current agent command snapshot and real bridge file reader; when the reader is missing only connection hints are shown.
 * @returns Draft, menu state, and event handlers for the textarea.
 */
export function useComposerCompletion(config: ComposerCompletionConfig) {
  const { commands, listWorkspaceEntries, workspace = "" } = config;
  /** High-frequency draft belongs only to Composer, not global session state. */
  const [draft, setDraft] = useState("");
  /** Caret position decides plain typing vs `@` file completion vs `/` command completion. */
  const [caret, setCaret] = useState(0);
  /** Result of the latest real bridge file scan (stale-while-revalidate while typing). */
  const [workspaceEntries, setWorkspaceEntries] = useState<
    ComposerWorkspaceEntry[]
  >([]);
  /**
   * True only for the first scan after the `@` menu opens.
   * Subsequent keystroke refetches stay silent so the empty/list label does not
   * flip ("Reading…" ↔ "No matching files") and paint as text jitter.
   */
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
  /**
   * Monotonic fetch id so an older bridge response cannot overwrite a newer query
   * after the user has already typed further.
   */
  const workspaceFetchGenRef = useRef(0);
  /**
   * Whether this `@` open cycle has completed at least one scan.
   * Ref (not state) so the effect can read it without re-subscribing every paint.
   */
  const hasLoadedEntriesRef = useRef(false);
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
    // Pass workspace so absolute pasted paths match relative bridge entries.
    return createMentionSuggestions(
      workspaceEntries,
      trigger.query,
      workspace,
    );
  }, [commands, trigger, workspace, workspaceEntries]);
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
    /** Slightly longer debounce so continuous typing does not thrash the bridge. */
    const delay = 160;
    let cancelled = false;

    if (!canLoadEntries || !listWorkspaceEntries) {
      // Leaving `@` resets the cycle so the next open shows a single loading state.
      workspaceFetchGenRef.current += 1;
      hasLoadedEntriesRef.current = false;
      setIsLoadingEntries(false);
      setHasWorkspaceLoadError(false);
      setWorkspaceEntries([]);
      return () => undefined;
    }

    setHasWorkspaceLoadError(false);
    const timer = setTimeout(() => {
      const fetchGen = workspaceFetchGenRef.current + 1;
      workspaceFetchGenRef.current = fetchGen;
      // Only the first scan of this open cycle owns the empty-state loading copy.
      if (!hasLoadedEntriesRef.current) {
        setIsLoadingEntries(true);
      }
      void listWorkspaceEntries(mentionQuery)
        .then(
          (entries) => {
            if (cancelled || workspaceFetchGenRef.current !== fetchGen) {
              return;
            }
            setWorkspaceEntries((prev) =>
              workspaceEntriesEqual(prev, entries) ? prev : entries,
            );
            hasLoadedEntriesRef.current = true;
            setHasWorkspaceLoadError(false);
          },
          () => {
            if (cancelled || workspaceFetchGenRef.current !== fetchGen) {
              return;
            }
            // Keep last good index when a background refresh fails mid-typing.
            if (!hasLoadedEntriesRef.current) {
              setWorkspaceEntries([]);
            }
            setHasWorkspaceLoadError(true);
          },
        )
        .finally(() => {
          if (cancelled || workspaceFetchGenRef.current !== fetchGen) {
            return;
          }
          setIsLoadingEntries(false);
        });
    }, delay);

    return () => {
      cancelled = true;
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
   * Track input and selection and reopen the menu on any new edit.
   * Typing never promotes text to a mention: only pickSuggestion commits a
   * token, because only the menu knows the path exists in the workspace.
   */
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    setCaret(event.target.selectionStart);
    setDismissedTriggerKey(null);
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
