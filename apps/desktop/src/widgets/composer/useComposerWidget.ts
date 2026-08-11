/**
 * Unified Composer state entry.
 * Connects the session store, real prompt send, mode / model / thinking controls;
 * completion by useComposerCompletion; attachments by useComposerAttachments;
 * voice mic by useComposerDictation; notice lifetime by useComposerNotice;
 * bar chrome (mode/model menus) by useComposerBarControls.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import type { AvailableCommand, AvailableModel } from "@grok-desktop/acp-core";
import { useSessionStore } from "../../store/sessionStore";
import {
  caretJumpOverMention,
  deleteMentionUnit,
  mentionUnitForBackspace,
  mentionUnitForDelete,
} from "@/lib/mentionTokens";
import { useComposerCompletion } from "./useComposerCompletion";
import { useComposerAttachments } from "./useComposerAttachments";
import { useComposerDictation } from "./useComposerDictation";
import { useComposerNotice } from "./useComposerNotice";
import { useComposerBarControls } from "./useComposerBarControls";
import { modeLabel } from "./composerModes";
import { runComposerSubmit } from "./composerSubmit";

/**
 * Reusable empty command snapshot so the Zustand selector does not allocate a new array
 * before any commands arrive. New arrays would make React think the external store snapshot
 * keeps changing and trigger infinite updates.
 */
const EMPTY_AVAILABLE_COMMANDS: AvailableCommand[] = [];
const EMPTY_CONFIG_OPTIONS: unknown[] = [];
const EMPTY_AVAILABLE_MODELS: AvailableModel[] = [];

/**
 * True while an IME is composing or the key event is the platform composition
 * marker (keyCode 229). Used so Enter confirms candidates instead of sending.
 * @param event Keyboard event from the composer textarea.
 * @param composing Session-local flag still true until the frame after compositionend
 *   (some engines fire a non-composing Enter on the same tick as compositionend).
 * @returns Whether the key must be left to the input method.
 */
export function isComposerImeKey(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "keyCode"> & {
    nativeEvent: Pick<KeyboardEvent<HTMLTextAreaElement>["nativeEvent"], "isComposing">;
  },
  composing: boolean,
): boolean {
  return (
    composing ||
    event.nativeEvent.isComposing ||
    // Deprecated but still the reliable IME marker across Chromium / Safari.
    event.keyCode === 229
  );
}

/**
 * Assembles state needed for Composer presentation and behavior.
 * @returns State and handlers bound to the current real bridge; local draft is kept on send failure.
 */
export function useComposerWidget() {
  const sendPrompt = useSessionStore((state) => state.sendPrompt);
  const cancelTurn = useSessionStore((state) => state.cancelTurn);
  const status = useSessionStore((state) => state.session.status);
  const connectionMode = useSessionStore((state) => state.connectionMode);
  const model = useSessionStore((state) => state.session.model);
  const mode = useSessionStore((state) => state.session.mode);
  const pendingMode = useSessionStore((state) => state.pendingMode);
  const setMode = useSessionStore((state) => state.setMode);
  const setModel = useSessionStore((state) => state.setModel);
  const configOptions = useSessionStore(
    (state) => state.session.configOptions ?? EMPTY_CONFIG_OPTIONS,
  );
  const availableModels = useSessionStore(
    (state) => state.session.availableModels ?? EMPTY_AVAILABLE_MODELS,
  );
  const bridgeInfo = useSessionStore((state) => state.bridgeInfo);
  const timelineLength = useSessionStore((state) => state.session.timeline.length);
  const commands = useSessionStore(
    (state) => state.session.availableCommands ?? EMPTY_AVAILABLE_COMMANDS,
  );
  const bridgeListWorkspaceEntries = useSessionStore(
    (state) => state.live?.listWorkspaceEntries,
  );
  const bridgeReadWorkspaceFile = useSessionStore(
    (state) => state.live?.readWorkspaceFile,
  );
  const workspace = useSessionStore((state) => state.session.workspace);
  const agentCapabilities = useSessionStore(
    (state) => state.session.agentCapabilities,
  );
  /**
   * Index the workspace of the session on screen, not whichever session the
   * bridge happened to start last. Stable identity keeps the completion effect
   * from refetching on every render.
   */
  const listWorkspaceEntries = useMemo(() => {
    if (!bridgeListWorkspaceEntries) {
      return undefined;
    }
    return (query: string) =>
      bridgeListWorkspaceEntries(query, workspace || undefined);
  }, [bridgeListWorkspaceEntries, workspace]);
  // workspace remaps absolute `@` queries (Finder paste) onto relative paths.
  const completion = useComposerCompletion({
    commands,
    listWorkspaceEntries,
    workspace,
  });
  /** Tone-aware notice channel; status text is resolved outside this hook. */
  const { notice, showNotice, clearNotice } = useComposerNotice();
  const bar = useComposerBarControls({
    mode,
    pendingMode,
    model,
    configOptions,
    availableModels,
    setMode,
    setModel,
  });

  const setDraft = completion.setDraft;
  const textareaRef = completion.textareaRef;

  const media = useComposerAttachments({
    agentCapabilities,
    draft: completion.draft,
    setDraft,
    textareaRef,
    showNotice,
    readWorkspaceFile: bridgeReadWorkspaceFile,
    workspace,
  });

  /**
   * Accept prefill from command palette / session menu (e.g. "/imagine ").
   * Claude/Codex put media slash stubs in the input, not as auto-sent top-nav clicks.
   */
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? "");
      if (!text) {
        return;
      }
      setDraft(text);
      showNotice("Edit the prompt, then Enter to send", "info");
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) {
          return;
        }
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    };
    window.addEventListener("grok-desktop:prefill-composer", onPrefill);
    return () =>
      window.removeEventListener("grok-desktop:prefill-composer", onPrefill);
  }, [setDraft, showNotice, textareaRef]);

  const streaming = status === "streaming";
  const waitingPermission = status === "waiting_permission";
  const canType = connectionMode !== "connecting";
  /**
   * Images alone only count as sendable when the agent advertises image input.
   * Unsupported thumbs still render for local preview; send stays disabled until
   * there is wire-ready content (text / mentions / capable images).
   */
  const hasSendableContent =
    completion.draft.trim().length > 0 ||
    (media.attachments.length > 0 && media.imageCapable);
  const canSend =
    canType && !waitingPermission && hasSendableContent && !streaming;

  const dictation = useComposerDictation({
    draft: completion.draft,
    canType,
    waitingPermission,
    setDraftWithCaret: completion.setDraftWithCaret,
    textareaRef,
    showNotice,
    onDraftChange: completion.handleDraftChange,
  });

  /**
   * Sends the current draft snapshot; newer typing while the bridge connects asynchronously is not cleared.
   * Mentions embed via bridge read; queue path is plain text with an explicit notice.
   * Focus returns to the field afterwards so the click-Send path keeps the same
   * keyboard state as Enter — including the Esc interrupt the live strip
   * advertises, which is bound to this textarea.
   */
  const submitDraft = () => {
    runComposerSubmit({
      sentDraft: completion.draft,
      attachmentCount: media.attachments.length,
      connectionMode,
      streaming,
      waitingPermission,
      canSend,
      bridgeInfo,
      buildOutgoingBlocks: media.buildOutgoingBlocks,
      sendPrompt,
      showNotice,
      clearNotice,
      clearDraftIfUnchanged: (sentDraft) => {
        completion.setDraft((current) =>
          current === sentDraft ? "" : current,
        );
      },
      restoreDraft: (sentDraft) => {
        completion.setDraft(sentDraft);
      },
      clearAttachments: media.clearAttachments,
      stopDictation: dictation.stopDictation,
    });
    textareaRef.current?.focus();
  };

  /**
   * Tracks IME composition across compositionend → confirming Enter.
   * Cleared on the next animation frame so the Enter that commits a candidate
   * does not also submit the draft.
   */
  const isComposingRef = useRef(false);

  /**
   * Marks the start of IME composition (pinyin / kana / hangul, etc.).
   * @param _event Composition event from the textarea; unused (presence is enough).
   */
  const handleCompositionStart = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = true;
  }, []);

  /**
   * Marks the end of IME composition after the browser finishes committing text.
   * Defers clearing so a same-tick confirming Enter still sees composing=true.
   * @param _event Composition event from the textarea; unused.
   */
  const handleCompositionEnd = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => {
    requestAnimationFrame(() => {
      isComposingRef.current = false;
    });
  }, []);

  /**
   * Handles completion-menu keys, ⇧Tab mode cycle, atomic mention arrows /
   * Backspace / Delete, Esc interrupt, and Enter send.
   * ⇧Tab always cycles Build → Plan → Ask (from pendingMode when in flight) so
   * the three modes can be flipped without waiting for agent confirmation; plain
   * Tab still accepts the active completion row when the menu is open.
   * While an IME is composing, all shortcuts are suppressed so Enter confirms
   * the candidate instead of sending.
   * Committed @file / /command chips are one unit for Left/Right (and delete):
   * a single ArrowLeft from just after the path lands before the chip body.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposerImeKey(event, isComposingRef.current)) {
      return;
    }
    // Mode cycle wins over completion: ⇧Tab never inserts a suggestion.
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      if (completion.isMenuOpen) {
        completion.dismissMenu();
      }
      bar.cycleMode();
      return;
    }
    if (completion.isMenuOpen && completion.activeSuggestion) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        completion.selectNextSuggestion();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        completion.selectPreviousSuggestion();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        completion.pickSuggestion(completion.activeSuggestion);
        return;
      }
    }
    if (completion.isMenuOpen && event.key === "Escape") {
      event.preventDefault();
      completion.dismissMenu();
      return;
    }
    /**
     * Esc interrupts the live turn (the strip above the card advertises it).
     * Scoped to the textarea on purpose: a window-level listener would race
     * every menu / drawer / modal that also closes on Escape and would cancel
     * a turn the user only meant to dismiss a popover from.
     */
    if (event.key === "Escape" && streaming) {
      event.preventDefault();
      cancelTurn();
      return;
    }

    const ta = event.currentTarget;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const collapsed = selStart === selEnd;
    /**
     * Plain Left/Right only (no Alt/Meta/Ctrl word-line jumps). Shift extends
     * a selection over the whole chip; without Shift the caret hops the unit.
     */
    const plainArrow =
      !event.altKey && !event.metaKey && !event.ctrlKey;
    if (
      plainArrow &&
      collapsed &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const direction = event.key === "ArrowLeft" ? "left" : "right";
      const jumped = caretJumpOverMention(
        completion.draft,
        selStart,
        direction,
      );
      if (jumped !== null) {
        event.preventDefault();
        if (event.shiftKey) {
          const from = Math.min(jumped, selStart);
          const to = Math.max(jumped, selStart);
          ta.setSelectionRange(from, to);
        } else {
          ta.setSelectionRange(jumped, jumped);
        }
        completion.handleSelection({ currentTarget: ta });
        return;
      }
    }

    /**
     * Atomic delete of a committed chip when the caret is collapsed on its
     * edge (or inside after a failed snap). Range selections keep browser
     * default so multi-char cuts still work.
     */
    if (
      collapsed &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      const unit =
        event.key === "Backspace"
          ? mentionUnitForBackspace(completion.draft, selStart)
          : mentionUnitForDelete(completion.draft, selStart);
      if (unit) {
        event.preventDefault();
        const next = deleteMentionUnit(completion.draft, unit);
        completion.setDraftWithCaret(next.value, next.caret);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  /**
   * Keep mention highlight layer scrolled with the textarea.
   * Reads scroll offsets only; does not write layout attributes except scrollTop/Left on the mirror.
   */
  const handleInputScroll = useCallback(() => {
    const ta = completion.textareaRef.current;
    if (!ta) {
      return;
    }
    const mirror = ta.previousElementSibling as HTMLElement | null;
    if (!mirror) {
      return;
    }
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, [completion.textareaRef]);

  return {
    ...completion,
    attachments: media.attachments,
    canSend,
    canType,
    cancelTurn,
    closeMenu: bar.closeMenu,
    closeModeMenu: bar.closeModeMenu,
    connectionMode,
    dictating: dictation.dictating,
    dragOver: media.dragOver,
    effort: bar.effort,
    effortLabel: bar.effortLabel,
    fileInputRef: media.fileInputRef,
    handleDragLeave: media.handleDragLeave,
    handleDragOver: media.handleDragOver,
    handleDrop: media.handleDrop,
    handleDraftChange: dictation.handleDraftChange,
    handleCompositionEnd,
    handleCompositionStart,
    handleFileInputChange: media.handleFileInputChange,
    handleInputScroll,
    handleKeyDown,
    handlePaste: media.handlePaste,
    imageCapable: media.imageCapable,
    mode: bar.confirmedMode,
    modeMenuOpen: bar.modeMenuOpen,
    modeOptions: bar.modeOptions,
    notice,
    openFilePicker: media.openFilePicker,
    pendingMode,
    removeAttachment: media.removeAttachment,
    stopDictation: dictation.stopDictation,
    toggleDictation: dictation.toggleDictation,
    menuOpen: bar.menuOpen,
    menuPanel: bar.menuPanel,
    model: bar.model,
    modelLabel: bar.modelLabel,
    models: bar.models,
    openPanel: bar.openPanel,
    resetControls: bar.resetControls,
    selectEffort: bar.selectEffort,
    selectMode: bar.selectMode,
    selectModel: bar.selectModel,
    status,
    streaming,
    submitDraft,
    thinkingOptions: bar.thinkingOptions,
    timelineLength,
    toggleMenu: bar.toggleMenu,
    toggleModeMenu: bar.toggleModeMenu,
    cycleMode: bar.cycleMode,
  };
}

export { modeLabel };
