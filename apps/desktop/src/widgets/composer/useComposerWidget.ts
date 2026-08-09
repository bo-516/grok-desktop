/**
 * Unified Composer state entry.
 * Connects the session store, real prompt send, mode / model / thinking controls;
 * completion interaction is owned by useComposerCompletion;
 * attachments by useComposerAttachments.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AvailableCommand,
  AvailableModel,
  AgentMode,
} from "@grok-desktop/acp-core";
import { useSessionStore } from "../../store/sessionStore";
import { createDictation } from "../../lib/voiceDictation";
import {
  defaultComposerControls,
  formatModelLabel,
  formatThinkingLabel,
  loadPreferredModel,
  loadThinkingEffort,
  resolveAgentDefaultModel,
  resolveModelOptions,
  savePreferredModel,
  saveThinkingEffort,
  THINKING_OPTIONS,
  type ThinkingEffort,
} from "./composerModels";
import type { ComposerMenuPanel } from "./ComposerModelMenuView";
import { useComposerCompletion } from "./useComposerCompletion";
import { useComposerAttachments } from "./useComposerAttachments";
import {
  AGENT_MODE_OPTIONS,
  modeLabel,
  nextMode,
  normalizeAgentMode,
} from "./composerModes";

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
  const listWorkspaceEntries = useSessionStore(
    (state) => state.live?.listWorkspaceEntries,
  );
  const agentCapabilities = useSessionStore(
    (state) => state.session.agentCapabilities,
  );
  const completion = useComposerCompletion({ commands, listWorkspaceEntries });
  /** Send-policy hint (streaming / permission / send failure); stays out of the global store. */
  const [sendHint, setSendHint] = useState("");
  /** Mode popover open state (local to composer). */
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const setDraft = completion.setDraft;
  const textareaRef = completion.textareaRef;

  const media = useComposerAttachments({
    agentCapabilities,
    draft: completion.draft,
    setDraft,
    textareaRef,
    setSendHint,
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
      setSendHint("Edit the prompt, then Enter to send");
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
  }, [setDraft, textareaRef]);

  /** Local thinking intensity; persisted separately from session protocol state. */
  const [effort, setEffort] = useState<ThinkingEffort>(() => loadThinkingEffort());
  /** Floating model/thinking menu visibility + nested panel. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<ComposerMenuPanel>(null);

  const preferredModel = useMemo(() => loadPreferredModel(), []);
  /** Prefer live session model; else local preference; else first agent catalog entry. */
  const effectiveModel =
    model ||
    preferredModel ||
    availableModels[0]?.id ||
    "";
  const models = useMemo(
    () =>
      resolveModelOptions(configOptions, availableModels, effectiveModel),
    [configOptions, availableModels, effectiveModel],
  );
  const modelLabel =
    models.find((m) => m.id === effectiveModel)?.label ??
    formatModelLabel(effectiveModel);
  const effortLabel = formatThinkingLabel(effort);

  const streaming = status === "streaming";
  const waitingPermission = status === "waiting_permission";
  const canType = connectionMode !== "connecting";
  const canSend =
    canType &&
    !waitingPermission &&
    (completion.draft.trim().length > 0 || media.attachments.length > 0) &&
    !streaming;

  const confirmedMode = normalizeAgentMode(mode);

  /**
   * Select a mode explicitly from the popover (or ⇧Tab cycle).
   * @param next Target mode; no-op when same as confirmed and nothing pending.
   */
  const selectMode = useCallback(
    (next: AgentMode) => {
      setModeMenuOpen(false);
      setMode(next);
    },
    [setMode],
  );

  /** Cycle mode via nextMode helper (⇧Tab when composer focused). */
  const cycleMode = useCallback(() => {
    const base = pendingMode ?? confirmedMode;
    selectMode(nextMode(base));
  }, [confirmedMode, pendingMode, selectMode]);

  const closeModeMenu = useCallback(() => {
    setModeMenuOpen(false);
  }, []);

  const toggleModeMenu = useCallback(() => {
    if (pendingMode !== null) {
      return;
    }
    setModeMenuOpen((o) => !o);
  }, [pendingMode]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPanel(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => {
      if (open) {
        setMenuPanel(null);
        return false;
      }
      setMenuPanel("root");
      return true;
    });
  }, []);

  const openPanel = useCallback((panel: ComposerMenuPanel) => {
    setMenuPanel(panel);
  }, []);

  /**
   * Selects a model for the session chrome and persists the preference.
   * @param id Model id from the submenu.
   */
  const selectModel = useCallback(
    (id: string) => {
      setModel(id);
      savePreferredModel(id);
      setMenuPanel("root");
    },
    [setModel],
  );

  /**
   * Selects thinking intensity and persists it for the next open.
   * @param id Effort level id.
   */
  const selectEffort = useCallback((id: ThinkingEffort) => {
    setEffort(id);
    saveThinkingEffort(id);
    setMenuPanel("root");
  }, []);

  /**
   * Resets model + thinking to agent/product defaults and closes the menu.
   * Model default is taken from agent config current / first availableModels entry.
   */
  const resetControls = useCallback(() => {
    const agentDefault = resolveAgentDefaultModel(
      configOptions,
      models,
      model,
    );
    const defaults = defaultComposerControls(agentDefault);
    if (defaults.modelId) {
      setModel(defaults.modelId);
      savePreferredModel(defaults.modelId);
    }
    setEffort(defaults.effort);
    saveThinkingEffort(defaults.effort);
    closeMenu();
  }, [closeMenu, configOptions, model, models, setModel]);

  /**
   * Sends the current draft snapshot; newer typing while the bridge connects asynchronously is not cleared.
   * While streaming / waiting_permission, draft is queued (F-STREAM-09) via store.sendPrompt — never dropped.
   * Images go as ACP ContentBlock.image when agentCapabilities.promptCapabilities.image is true.
   */
  const submitDraft = () => {
    const sentDraft = completion.draft;
    if (!sentDraft.trim() && media.attachments.length === 0) {
      return;
    }
    if (connectionMode === "disconnected") {
      setSendHint("Bridge not connected — run npm run bridge and reconnect");
      return;
    }
    if (streaming || waitingPermission) {
      if (media.attachments.length > 0) {
        setSendHint(
          "Attachments wait until the current turn finishes — send again when idle",
        );
        return;
      }
      setSendHint("Queued — will send after this turn finishes");
      void sendPrompt(sentDraft).then((sent) => {
        if (sent) {
          completion.setDraft((current) =>
            current === sentDraft ? "" : current,
          );
        }
      });
      return;
    }
    if (!canSend) {
      return;
    }

    const { blocks, text } = media.buildOutgoingBlocks();
    setSendHint("");
    void sendPrompt(text, blocks).then((sent) => {
      if (sent) {
        completion.setDraft((current) =>
          current === sentDraft ? "" : current,
        );
        media.clearAttachments();
        setSendHint("");
      } else {
        setSendHint(
          bridgeInfo.startsWith("error:") ||
            /unable|cannot|failed/i.test(bridgeInfo)
            ? bridgeInfo
            : "Send failed — draft kept; check the connection or start a new chat",
        );
      }
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
      cycleMode();
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

  /** F-MEDIA-04: voice dictation via Web Speech API when available. */
  const startDictation = useCallback(() => {
    const handle = createDictation(
      (text) => {
        completion.setDraft((d) => (d ? `${d} ${text}` : text));
      },
      (err) => setSendHint(`Dictation: ${err}`),
    );
    if (!handle.supported) {
      setSendHint(handle.reason);
      return;
    }
    handle.start();
    setSendHint("Listening… (stop via browser / mic UI)");
  }, [completion]);

  return {
    ...completion,
    attachments: media.attachments,
    canSend,
    canType,
    cancelTurn,
    closeMenu,
    closeModeMenu,
    connectionMode,
    dragOver: media.dragOver,
    effort,
    effortLabel,
    handleDragLeave: media.handleDragLeave,
    handleDragOver: media.handleDragOver,
    handleDrop: media.handleDrop,
    handleInputScroll,
    handleKeyDown,
    handlePaste: media.handlePaste,
    imageCapable: media.imageCapable,
    mode: confirmedMode,
    modeMenuOpen,
    modeOptions: AGENT_MODE_OPTIONS,
    pendingMode,
    removeAttachment: media.removeAttachment,
    startDictation,
    menuOpen,
    menuPanel,
    model: effectiveModel,
    modelLabel,
    models,
    openPanel,
    resetControls,
    selectEffort,
    selectMode,
    selectModel,
    sendHint,
    status,
    streaming,
    submitDraft,
    thinkingOptions: THINKING_OPTIONS,
    timelineLength,
    toggleMenu,
    toggleModeMenu,
    cycleMode,
  };
}

export { modeLabel };
