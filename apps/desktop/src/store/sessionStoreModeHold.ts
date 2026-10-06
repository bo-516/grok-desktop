/**
 * Background Ask / Plan / Build switch.
 *
 * The chip writes session.mode immediately. grok-build still takes time inside
 * session/set_mode. That wait stays off the chip: a prompt painted during it
 * is held until the bridge reports `mode set to <id>` (the RPC returned).
 * A timeout or restart_required reverts the chip and does not send.
 */

import type { AgentMode, ContentBlock } from "@grok-desktop/acp-core";
import { restoreComposerDraft } from "@/lib/composerFocus";
import {
  armPendingModeTimeout,
  clearPendingModeTimer,
} from "./pendingMode";
import {
  rollbackOptimisticLocalUser,
  type HeldPrompt,
  type ModeHoldGet,
  type ModeHoldSet,
  type ModeHoldState,
} from "./sessionStoreModeHoldCanvas";

export type { HeldPrompt, ModeHoldGet, ModeHoldSet, ModeHoldState };

/** Bridge info line after a successful session/set_mode (`mode set to plan`). */
const MODE_READY_RE = /^mode set to (ask|plan|build)$/;

/** Shown when the switch fails and a message was waiting. */
const HELD_FAIL_NOTICE =
  "Mode didn't switch in time — your message was not sent";

/** Shown when the switch fails and the user had not sent. */
const QUIET_FAIL_NOTICE = "Mode didn't switch in time";

/**
 * Map a raw mode string onto ask / plan / build.
 * @param mode Session or UI mode; unknown and empty become build.
 * @returns Product mode id.
 */
function paintedMode(mode: string | null | undefined): AgentMode {
  if (mode === "ask" || mode === "plan" || mode === "build") {
    return mode;
  }
  return "build";
}

/**
 * Parse the bridge info line that means session/set_mode has returned.
 * @param message Info text from the bridge. Other info lines return null.
 * @returns Mode id the RPC finished applying, or null when this is not that line.
 */
export function modeFromReadyInfo(message: string): AgentMode | null {
  const match = MODE_READY_RE.exec(message.trim());
  const mode = match?.[1];
  if (mode === "ask" || mode === "plan" || mode === "build") {
    return mode;
  }
  return null;
}

/**
 * Canvas id the open chat is bound to.
 * Prefers the painted session, then the rail selection, then the pool active id.
 * @param state Mode-hold slice.
 * @returns Trimmed id, or empty when this is still a New chat draft.
 */
function canvasSessionId(state: ModeHoldState): string {
  return (
    state.session.id.trim() ||
    state.viewingSessionId?.trim() ||
    state.activeSessionId?.trim() ||
    ""
  );
}

/**
 * Start a mode switch. The chip updates now; the RPC is best-effort.
 * A New chat draft (no session id) only records the target — the first send
 * fires session/set_mode once the session exists. Retargeting keeps the
 * original confirmed mode so a failure can revert.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param mode Target the user picked. Unknown values normalize to build.
 */
export function beginModeSwitch<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  mode: AgentMode,
): void {
  const target = paintedMode(mode);
  const state = get();
  const pending = state.pendingMode ?? null;
  const sessionMode = paintedMode(state.session.mode);
  if (pending === target) {
    return;
  }
  if (pending === null && sessionMode === target) {
    return;
  }
  const confirmed =
    pending === null ? sessionMode : (state.confirmedMode ?? sessionMode);
  const sid = canvasSessionId(state);
  const live = state.live;
  const canRpc = Boolean(live) && state.connectionMode === "live-bridge" && sid;
  set({
    pendingMode: target,
    confirmedMode: confirmed,
    modeRpcSessionId: canRpc ? sid : null,
    session: { ...state.session, mode: target },
  } as Partial<S>);
  if (canRpc && live) {
    live.setMode(target, sid);
    armPendingModeTimeout(() => {
      failModeSwitch(set, get, "");
    });
    return;
  }
  // Draft: don't start the failure clock until a session exists to switch.
  clearPendingModeTimer();
}

/**
 * Drop an in-flight switch because the user left this canvas.
 * Reverts the chip to the last confirmed mode and removes a held bubble so
 * the catalog does not persist a turn that was never sent. Does not restore
 * the composer — the canvas is going away.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function abandonModeSwitch<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
): void {
  clearPendingModeTimer();
  const state = get();
  const pending = state.pendingMode ?? null;
  const held = state.heldPrompt ?? null;
  const confirmed = state.confirmedMode ?? null;
  set({
    pendingMode: null,
    confirmedMode: null,
    modeRpcSessionId: null,
    heldPrompt: null,
    session:
      pending && confirmed
        ? { ...state.session, mode: confirmed }
        : state.session,
  } as Partial<S>);
  if (held) {
    rollbackOptimisticLocalUser(set, get);
  }
}

/**
 * The switch failed (timeout, unsupported method). Revert the chip. If a
 * message was pretending to send, remove that bubble and put the text back
 * when the composer is still empty.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param reason Bridge reason to show. Empty uses the timeout copy.
 */
export function failModeSwitch<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  reason: string,
): void {
  const state = get();
  if ((state.pendingMode ?? null) === null && !(state.heldPrompt ?? null)) {
    return;
  }
  clearPendingModeTimer();
  const held = state.heldPrompt ?? null;
  const confirmed = state.confirmedMode ?? paintedMode(state.session.mode);
  const notice =
    reason.trim() || (held ? HELD_FAIL_NOTICE : QUIET_FAIL_NOTICE);
  set({
    pendingMode: null,
    confirmedMode: null,
    modeRpcSessionId: null,
    heldPrompt: null,
    bridgeInfo: notice,
    session: { ...state.session, mode: confirmed },
  } as Partial<S>);
  if (held) {
    rollbackOptimisticLocalUser(set, get);
    restoreComposerDraft({ text: held.text, notice });
  }
}

/**
 * session/set_mode finished. Release a held prompt into the real turn.
 * Info for a different mode or a different session is ignored so a slow
 * earlier RPC cannot confirm the user's latest choice.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param message Bridge info text.
 * @param sessionId Session the info was stamped with, when the bridge sent one.
 */
export function noteModeReadyInfo<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  message: string,
  sessionId?: string,
): void {
  const ready = modeFromReadyInfo(message);
  const state = get();
  const pending = state.pendingMode ?? null;
  if (!ready || pending === null || ready !== pending) {
    return;
  }
  const rpcSid = state.modeRpcSessionId ?? "";
  if (!rpcSid) {
    return;
  }
  if (sessionId && sessionId !== rpcSid) {
    return;
  }
  clearPendingModeTimer();
  const held = state.heldPrompt ?? null;
  set({
    pendingMode: null,
    confirmedMode: null,
    modeRpcSessionId: null,
  } as Partial<S>);
  if (held) {
    flushHeldPrompt(set, get, held);
  }
}

/**
 * restart_required for mode means grok-build will not apply the switch.
 * Other settings (model, spawn) leave the mode gate alone.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param setting restart_required setting field.
 * @param reason Human-readable reason from the bridge.
 */
export function noteModeRestartRequired<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  setting: string,
  reason: string,
): void {
  if (setting !== "mode") {
    return;
  }
  if ((get().pendingMode ?? null) === null) {
    return;
  }
  failModeSwitch(set, get, reason);
}

/**
 * Park a painted prompt until the mode RPC returns.
 * On a draft, this is also what fires session/set_mode the first time,
 * now that a session id exists.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param text Trimmed prompt text.
 * @param blocks Image / resource blocks, when the send had any.
 * @param sessionId Canvas session the bubble was painted for.
 * @returns True when the caller must not call live.prompt yet.
 */
export function deferPromptForPendingMode<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  text: string,
  blocks: ContentBlock[] | undefined,
  sessionId: string,
): boolean {
  const state = get();
  const pending = state.pendingMode ?? null;
  if (!pending) {
    return false;
  }
  const live = state.live;
  const rpcSid = state.modeRpcSessionId ?? "";
  if (live && state.connectionMode === "live-bridge") {
    if (rpcSid !== sessionId) {
      live.setMode(pending, sessionId);
      set({ modeRpcSessionId: sessionId } as Partial<S>);
    }
    // Clock starts at send, so a switch that is almost at its ceiling
    // does not yank the message the user just watched leave the box.
    armPendingModeTimeout(() => {
      failModeSwitch(set, get, "");
    });
  }
  set({
    heldPrompt: {
      text,
      blocks,
      sessionId,
    },
  } as Partial<S>);
  return true;
}

/**
 * Stop the open turn.
 * A prompt that is only painted (mode switch still in flight) is dropped
 * locally: no session/cancel, chip stays on the chosen mode.
 * A real grok-build turn is cancelled on the bridge.
 * @param set Zustand set.
 * @param get Zustand get.
 * @returns True when a held prompt was dropped and the canvas is idle again,
 *   so a queued "send now" can drain immediately. False when a real cancel
 *   was issued (the queue drains on the later idle edge).
 */
export function cancelTurnAction<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
): boolean {
  if (releaseHeldPromptOnCancel(set, get)) {
    return true;
  }
  const state = get();
  if (state.connectionMode === "live-bridge" && state.live) {
    state.live.cancel(
      state.session.id ||
        state.viewingSessionId ||
        state.activeSessionId ||
        undefined,
    );
  }
  return false;
}

/**
 * Stop while the turn is only pretended. Drops the held prompt and the
 * bubble. Does not call session/cancel — grok-build has no turn yet — and
 * does not revert the chip. The mode RPC keeps running.
 * @param set Zustand set.
 * @param get Zustand get.
 * @returns True when a held prompt was dropped. False when the caller should
 *   cancel a real in-flight turn.
 */
function releaseHeldPromptOnCancel<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
): boolean {
  const state = get();
  const held = state.heldPrompt ?? null;
  if (!held) {
    return false;
  }
  const canvas = canvasSessionId(state);
  if (held.sessionId && canvas && held.sessionId !== canvas) {
    return false;
  }
  set({ heldPrompt: null } as Partial<S>);
  rollbackOptimisticLocalUser(set, get);
  return true;
}

/**
 * Hand a held prompt to the bridge now that the mode RPC has returned.
 * Seeds the reduce bucket first so image blocks survive the text echo.
 * A failed write rolls the bubble back and restores the draft.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param held Prompt captured at send time.
 */
function flushHeldPrompt<S extends ModeHoldState>(
  set: ModeHoldSet<S>,
  get: ModeHoldGet<S>,
  held: HeldPrompt,
): void {
  const state = get();
  const live = state.live;
  const sid = held.sessionId || state.session.id.trim();
  set({ heldPrompt: null } as Partial<S>);
  if (!live || state.connectionMode !== "live-bridge" || !sid) {
    rollbackOptimisticLocalUser(set, get);
    restoreComposerDraft({
      text: held.text,
      notice: "Send failed: bridge not connected. Run npm run bridge",
    });
    set({
      bridgeInfo: "Send failed: bridge not connected. Run npm run bridge",
    } as Partial<S>);
    return;
  }
  const painted = get().session;
  if (painted.timeline.length > 0) {
    live.seedSession?.({
      ...painted,
      id: painted.id.trim() || sid,
    });
  }
  const ok = live.prompt(held.text, sid, held.blocks);
  if (!ok) {
    rollbackOptimisticLocalUser(set, get);
    restoreComposerDraft({
      text: held.text,
      notice: "Send failed: bridge not connected. Run npm run bridge",
    });
    set({
      bridgeInfo: "Send failed: bridge not connected. Run npm run bridge",
      lastError: "bridge not connected",
    } as Partial<S>);
  }
}
