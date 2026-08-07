/**
 * Unified Composer state entry.
 * Connects the session store, real prompt send, and mode switching only;
 * completion interaction is owned by useComposerCompletion.
 */

import { useState, type KeyboardEvent } from "react";
import type { AvailableCommand } from "@grok-desktop/acp-core";
import { useSessionStore } from "../../store/sessionStore";
import { useComposerCompletion } from "./useComposerCompletion";

/**
 * Reusable empty command snapshot so the Zustand selector does not allocate a new array
 * before any commands arrive. New arrays would make React think the external store snapshot
 * keeps changing and trigger infinite updates.
 */
const EMPTY_AVAILABLE_COMMANDS: AvailableCommand[] = [];

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
  const setMode = useSessionStore((state) => state.setMode);
  const bridgeInfo = useSessionStore((state) => state.bridgeInfo);
  const timelineLength = useSessionStore((state) => state.session.timeline.length);
  const commands = useSessionStore(
    (state) => state.session.availableCommands ?? EMPTY_AVAILABLE_COMMANDS,
  );
  const listWorkspaceEntries = useSessionStore(
    (state) => state.live?.listWorkspaceEntries,
  );
  const completion = useComposerCompletion({ commands, listWorkspaceEntries });
  /** Send-policy hint (streaming / permission / send failure); stays out of the global store. */
  const [sendHint, setSendHint] = useState("");
  const streaming = status === "streaming";
  const waitingPermission = status === "waiting_permission";
  const canType = connectionMode !== "connecting";
  const canSend =
    canType &&
    !waitingPermission &&
    completion.draft.trim().length > 0 &&
    !streaming;

  /** Cycles Ask → Plan → Build; later agent current_mode_update can still override the local display. */
  const cycleMode = () => {
    if (mode === "build") {setMode("plan");}
    else if (mode === "plan") {setMode("ask");}
    else {setMode("build");}
  };

  /**
   * Sends the current draft snapshot; newer typing while the bridge connects asynchronously is not cleared.
   * While streaming or waiting on permission, only surface a hint — do not silently swallow Enter.
   */
  const submitDraft = () => {
    const sentDraft = completion.draft;
    if (streaming) {
      setSendHint("Generating — click Stop or wait until it finishes before sending");
      return;
    }
    if (waitingPermission) {
      setSendHint("Waiting for permission — choose Allow or Deny in the dialog first");
      return;
    }
    if (connectionMode === "disconnected") {
      setSendHint("Bridge not connected — run npm run bridge and reconnect");
      return;
    }
    if (!canSend) {return;}

    setSendHint("");
    void sendPrompt(sentDraft).then((sent) => {
      if (sent) {
        completion.setDraft((current) =>
          current === sentDraft ? "" : current,
        );
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

  /** Handles completion-menu keys and the normal send shortcut; Shift+Enter always inserts a newline. */
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  return {
    ...completion,
    canSend,
    canType,
    cancelTurn,
    connectionMode,
    handleKeyDown,
    mode,
    model,
    sendHint,
    setMode: cycleMode,
    status,
    streaming,
    submitDraft,
    timelineLength,
  };
}

/**
 * Maps an ACP mode id to the Composer display name.
 * @param mode Agent or locally selected mode; unknown values safely fall back to Build.
 * @returns Fixed mode label.
 */
export function modeLabel(mode: string): string {
  if (mode === "ask") {return "Ask";}
  if (mode === "plan") {return "Plan";}
  return "Build";
}
