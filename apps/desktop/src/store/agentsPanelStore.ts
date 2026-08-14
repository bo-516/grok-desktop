/**
 * Agents companion focus + shared Plan|Agents drawer width. Independent of
 * sessionStore so roster / focus / drag updates do not rerender the timeline.
 */

import { create } from "zustand";
import {
  AGENTS_WIDTH_DEFAULT,
  AGENTS_WIDTH_MAX,
  AGENTS_WIDTH_MIN,
  AGENTS_WIDTH_STORAGE_KEY,
} from "@/lib/agentsPanelWidth";

export {
  AGENTS_WIDTH_DEFAULT,
  AGENTS_WIDTH_MAX,
  AGENTS_WIDTH_MIN,
  AGENTS_WIDTH_STORAGE_KEY,
} from "@/lib/agentsPanelWidth";

/** Panel current object: roster (parent view) or one child transcript. */
export type AgentsFocus =
  | { kind: "roster" }
  | { kind: "subagent"; childSessionId: string };

/**
 * Clamp a pixel width into the shared Plan|Agents drawer range.
 * @param px Raw width from drag or storage.
 * @returns Integer px within [min, max]; non-finite → default.
 */
export function clampAgentsWidth(px: number): number {
  if (!Number.isFinite(px)) {
    return AGENTS_WIDTH_DEFAULT;
  }
  return Math.min(
    AGENTS_WIDTH_MAX,
    Math.max(AGENTS_WIDTH_MIN, Math.round(px)),
  );
}

/**
 * Load persisted Plan|Agents drawer width from localStorage; default otherwise.
 * @returns Clamped width in px.
 */
export function loadAgentsWidth(): number {
  if (typeof localStorage === "undefined") {
    return AGENTS_WIDTH_DEFAULT;
  }
  try {
    const raw = localStorage.getItem(AGENTS_WIDTH_STORAGE_KEY);
    if (raw == null) {
      return AGENTS_WIDTH_DEFAULT;
    }
    return clampAgentsWidth(Number(raw));
  } catch {
    return AGENTS_WIDTH_DEFAULT;
  }
}

/**
 * Persist Plan|Agents drawer width to localStorage.
 * @param px Width to store (clamped first).
 */
export function saveAgentsWidth(px: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      AGENTS_WIDTH_STORAGE_KEY,
      String(clampAgentsWidth(px)),
    );
  } catch {
    // quota / private mode — ignore
  }
}

/**
 * Treat a stored focus as roster when it belongs to another viewing session.
 * @param focus Store focus (may be stale after a session switch).
 * @param ownerSessionId Session that owned the focus when it was set.
 * @param viewingSessionId Current main-canvas session id.
 * @returns `focus` when owner matches; otherwise roster.
 */
export function effectiveAgentsFocus(
  focus: AgentsFocus,
  ownerSessionId: string | null,
  viewingSessionId: string | null,
): AgentsFocus {
  if (focus.kind === "roster") {
    return focus;
  }
  if (!ownerSessionId || ownerSessionId !== viewingSessionId) {
    return { kind: "roster" };
  }
  return focus;
}

/**
 * Move focus along the roster order. Past the last / before the first lands
 * on roster (no wrap). Roster + next → first id; roster + prev stays roster.
 * @param focus Current (already-effective) focus.
 * @param delta +1 next / −1 previous.
 * @param orderedIds Child ids in `groupSubagentsByRound` order.
 * @returns Next focus; empty `orderedIds` always yields roster.
 */
export function cycleAgentsFocus(
  focus: AgentsFocus,
  delta: 1 | -1,
  orderedIds: string[],
): AgentsFocus {
  if (orderedIds.length === 0) {
    return { kind: "roster" };
  }
  if (focus.kind === "roster") {
    if (delta === 1) {
      return { kind: "subagent", childSessionId: orderedIds[0] ?? "" };
    }
    return { kind: "roster" };
  }
  const idx = orderedIds.indexOf(focus.childSessionId);
  if (idx < 0) {
    return { kind: "roster" };
  }
  const next = idx + delta;
  if (next < 0 || next >= orderedIds.length) {
    return { kind: "roster" };
  }
  const id = orderedIds[next];
  if (!id) {
    return { kind: "roster" };
  }
  return { kind: "subagent", childSessionId: id };
}

/**
 * Two-level Escape: detail → roster (drawer stays open); roster → close.
 * @param effectiveFocus Focus after owner/session reconciliation.
 * @returns `"roster"` to clear detail; `"close"` to dismiss the drawer.
 */
export function agentsEscapeAction(
  effectiveFocus: AgentsFocus,
): "roster" | "close" {
  return effectiveFocus.kind === "subagent" ? "roster" : "close";
}

/**
 * Decide what Escape does for the shared Plan|Agents drawer.
 * @param args Open flag, active tab, effective Agents focus.
 * @returns `ignore` when closed; `roster` on Agents detail; otherwise `close`.
 */
export function nextAgentsDrawerEscape(args: {
  open: boolean;
  rail: "plan" | "agents" | null;
  effectiveFocus: AgentsFocus;
}): "close" | "roster" | "ignore" {
  if (!args.open) {
    return "ignore";
  }
  if (args.rail === "agents" && args.effectiveFocus.kind === "subagent") {
    return "roster";
  }
  return "close";
}

type AgentsPanelStoreState = {
  /** Current focus; session switch resets to roster. */
  focus: AgentsFocus;
  /** Shared Plan|Agents drawer width (px, clamped). Tab switches keep this. */
  width: number;
  /**
   * Session that owns `focus`. Readers treat a mismatch with the viewing
   * session as roster so a stale child cannot leak across chats.
   */
  ownerSessionId: string | null;
  /**
   * Focus a child in the panel. Does not touch the main-canvas session.
   * @param childSessionId Child ACP session id from the subagent card.
   * @param ownerSessionId Current parent session id; omit to keep owner.
   */
  focusSubagent: (childSessionId: string, ownerSessionId?: string) => void;
  /** Return to the roster (Esc on detail). */
  focusRoster: () => void;
  /**
   * Cycle along ordered child ids. Out of range → roster (no wrap).
   * @param delta +1 next / −1 previous.
   * @param orderedIds Round-then-spawn child ids.
   */
  cycle: (delta: 1 | -1, orderedIds: string[]) => void;
  /**
   * Commit a new Plan|Agents drawer width (pointer-up). Clamps and persists.
   * @param px Desired width in CSS pixels.
   */
  setWidth: (px: number) => void;
  /**
   * Session switch: drop detail and record the new owner.
   * @param sessionId Next viewing session id, or null for a blank draft.
   */
  resetForSession: (sessionId: string | null) => void;
};

/**
 * Zustand store for Agents inspect chrome (focus + width only).
 * Subscribe by field; the main timeline must not listen to this store.
 */
export const useAgentsPanelStore = create<AgentsPanelStoreState>((set, get) => ({
  focus: { kind: "roster" },
  width: loadAgentsWidth(),
  ownerSessionId: null,
  focusSubagent: (childSessionId, ownerSessionId) => {
    const id = childSessionId.trim();
    if (!id) {
      return;
    }
    const owner =
      ownerSessionId !== undefined
        ? ownerSessionId.trim() || null
        : get().ownerSessionId;
    set({
      focus: { kind: "subagent", childSessionId: id },
      ownerSessionId: owner,
    });
  },
  focusRoster: () => set({ focus: { kind: "roster" } }),
  cycle: (delta, orderedIds) => {
    const next = cycleAgentsFocus(get().focus, delta, orderedIds);
    set({ focus: next });
  },
  setWidth: (px) => {
    const width = clampAgentsWidth(px);
    saveAgentsWidth(width);
    set({ width });
  },
  resetForSession: (sessionId) => {
    set({
      focus: { kind: "roster" },
      ownerSessionId: sessionId?.trim() || null,
    });
  },
}));

/**
 * Reset store fields for isolated unit tests (singleton Zustand module).
 * Does not touch localStorage.
 */
export function resetAgentsPanelStoreForTests(): void {
  useAgentsPanelStore.setState({
    focus: { kind: "roster" },
    width: AGENTS_WIDTH_DEFAULT,
    ownerSessionId: null,
  });
}
