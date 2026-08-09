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
  type KeyboardEvent,
} from "react";
import type { AvailableCommand, AvailableModel } from "@grok-desktop/acp-core";
import { useSessionStore } from "../../store/sessionStore";
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
  const completion = useComposerCompletion({ commands, listWorkspaceEntries });
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
  const canSend =
    canType &&
    !waitingPermission &&
    (completion.draft.trim().length > 0 || media.attachments.length > 0) &&
    !streaming;

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
      clearAttachments: media.clearAttachments,
      stopDictation: dictation.stopDictation,
    });
  };

  /**
   * Handles completion-menu keys, ⇧Tab mode cycle, and Enter send.
   * ⇧Tab only when the completion menu is closed so Tab still accepts suggestions.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
    // ⇧Tab cycles mode only when composer is focused and completion is closed.
    if (
      event.key === "Tab" &&
      event.shiftKey &&
      !completion.isMenuOpen &&
      pendingMode === null
    ) {
      event.preventDefault();
      bar.cycleMode();
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
    cancelTurn,
    closeMenu: bar.closeMenu,
    closeModeMenu: bar.closeModeMenu,
    connectionMode,
    dictating: dictation.dictating,
    dragOver: media.dragOver,
    effort: bar.effort,
    effortLabel: bar.effortLabel,
    handleDragLeave: media.handleDragLeave,
    handleDragOver: media.handleDragOver,
    handleDrop: media.handleDrop,
    handleDraftChange: dictation.handleDraftChange,
    handleInputScroll,
    handleKeyDown,
    handlePaste: media.handlePaste,
    imageCapable: media.imageCapable,
    mode: bar.confirmedMode,
    modeMenuOpen: bar.modeMenuOpen,
    modeOptions: bar.modeOptions,
    notice,
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
