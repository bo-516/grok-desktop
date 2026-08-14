/**
 * Unified Composer state entry.
 * Connects the session store, real prompt send, mode / model / thinking controls;
 * completion by useComposerCompletion; attachments by useComposerAttachments;
 * voice mic by useComposerDictation; notice lifetime by useComposerNotice;
 * bar chrome (mode/model menus) by useComposerBarControls;
 * New-chat / slash-stub focus by useComposerFocusEvents;
 * slash catalog by useComposerSlashCatalog (live + persist + inspect + desktop
 * `/model` / `/effort`); those two pager commands apply on argument-menu pick
 * (Enter / click) and are intercepted again on send if typed in full.
 */

import {
  useCallback,
  useMemo,
  useRef,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import type { AvailableModel } from "@grok-desktop/acp-core";
import { useSessionStore } from "../../store/sessionStore";
import { useComposerCompletion } from "./useComposerCompletion";
import { tryComposerMentionKey } from "./composerMentionKeys";
import { useComposerAttachments } from "./useComposerAttachments";
import { useComposerDictation } from "./useComposerDictation";
import { useComposerNotice } from "./useComposerNotice";
import { useComposerBarControls } from "./useComposerBarControls";
import { useContextUsageDisplay } from "./useContextUsageDisplay";
import { useComposerFocusEvents } from "./useComposerFocusEvents";
import { useComposerSlashCatalog } from "./useComposerSlashCatalog";
import {
  applyLocalSlashDraftFromBar,
  bindTryLocalSlashFromBar,
} from "@/lib/slashBuiltinsApply";
import { isComposerImeKey } from "./composerIme";
import { modeLabel } from "./composerModes";
import { runComposerSubmit } from "./composerSubmit";

const EMPTY_CONFIG_OPTIONS: unknown[] = [];
const EMPTY_AVAILABLE_MODELS: AvailableModel[] = [];

export { isComposerImeKey } from "./composerIme";

/**
 * Assembles state needed for Composer presentation and behavior.
 * @returns State and handlers bound to the current real bridge; local draft is kept on send failure.
 */
export function useComposerWidget() {
  const sendPrompt = useSessionStore((state) => state.sendPrompt);
  const forkSession = useSessionStore((state) => state.forkSession);
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
  /** Live occupancy + last-turn billed usage for the context ring. */
  const tokenUsage = useSessionStore((state) => state.session.tokenUsage);
  /** Prebuilt ring view-model; null when the pref is off or occupancy is unknown. */
  const contextUsageDisplay = useContextUsageDisplay(
    model,
    availableModels,
    tokenUsage,
  );
  const bridgeInfo = useSessionStore((state) => state.bridgeInfo);
  const timelineLength = useSessionStore((state) => state.session.timeline.length);
  /** Live handshake + last-known persist + inspect skills (New chat must not wait). */
  const slash = useComposerSlashCatalog();
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
  /**
   * Session ops that `/fork` / `/rewind` share with the ⋯ menu and ⌘K.
   * Spread onto the bar so pick and submit use the same apply path.
   */
  const slashBar = {
    ...bar,
    forkSession: () => {
      void forkSession();
    },
    openRewind: () => {
      window.dispatchEvent(new CustomEvent("grok-desktop:open-rewind"));
    },
  };
  // workspace remaps absolute `@` queries (Finder paste) onto relative paths.
  const completion = useComposerCompletion({
    commands: slash.commands,
    models: bar.models,
    availableModels,
    currentModel: bar.model,
    listWorkspaceEntries,
    workspace,
    connectionMode,
    isLoadingCommands: slash.isLoading,
    applyArgDraft: (text) =>
      applyLocalSlashDraftFromBar(text, slashBar, showNotice),
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
   * Prefill (⌘K slash stubs) and New-chat focus (rail / ⌘N / palette / ⋯).
   * The store only dispatches; this hook owns the textarea.
   */
  useComposerFocusEvents({
    setDraftWithCaret: completion.setDraftWithCaret,
    showNotice,
    textareaRef,
  });

  const viewingSubagent = useSessionStore((state) => state.viewingSubagent);
  const streaming = status === "streaming";
  const waitingPermission = status === "waiting_permission";
  const canType = connectionMode !== "connecting" && !viewingSubagent;
  /**
   * Images alone only count as sendable when the agent advertises image input.
   * Unsupported thumbs still render for local preview; send stays disabled until
   * there is wire-ready content (text / mentions / capable images).
   * Harness subagent sessions are store-derived readonly — never send into them.
   */
  const hasSendableContent =
    completion.draft.trim().length > 0 ||
    (media.attachments.length > 0 && media.imageCapable);
  const canSend =
    canType &&
    !waitingPermission &&
    hasSendableContent &&
    !streaming &&
    !viewingSubagent;

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
      tryLocalSlash: bindTryLocalSlashFromBar(slashBar, showNotice, () =>
        completion.setDraft(""),
      ),
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
   * Enter / Tab on a `/model` / `/effort` argument row applies chrome immediately
   * (via pickSuggestion); `@` / skill / command-name rows still insert.
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
    if (
      tryComposerMentionKey(event, {
        draft: completion.draft,
        handleSelection: completion.handleSelection,
        setDraftWithCaret: completion.setDraftWithCaret,
      })
    ) {
      return;
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
    viewingSubagent,
    cancelTurn,
    closeMenu: bar.closeMenu,
    closeModeMenu: bar.closeModeMenu,
    connectionMode,
    /**
     * Context-usage ring model when Settings → Appearance is on and occupancy
     * is known; null hides the pie so restore cannot flash "0 of 500k".
     * Built from session.tokenUsage + model totalContextTokens.
     */
    contextUsageDisplay,
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
