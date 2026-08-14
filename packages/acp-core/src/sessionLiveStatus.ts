/**
 * Promote SessionState to streaming when live work arrives after an idle
 * hydrate (session/load handshake forces idle so history does not look live).
 * Pure — no I/O.
 */

import type { SessionState } from "./types.js";

/**
 * Mark the session streaming because a thought / tool / answer chunk arrived.
 * Keeps `waiting_permission` and `disconnected` intact — those are explicit
 * gates. Same-status returns the same reference so reducers stay cheap.
 *
 * @param state Current snapshot.
 * @returns State with status streaming when the session may accept live work.
 */
export function withLiveStreamingStatus(state: SessionState): SessionState {
  if (
    state.status === "waiting_permission" ||
    state.status === "disconnected" ||
    state.status === "streaming"
  ) {
    return state;
  }
  return { ...state, status: "streaming" };
}

/**
 * Whether the ACP client may arm the short idle quiet window.
 * After session/load this process has not sent a prompt; a still-running
 * turn would flicker Worked on every thought/tool gap if we settled.
 * `{ force: true }` is turn_completed / cancel.
 * @param args Force flag + whether this process originated a prompt.
 * @returns True when scheduleSettle should start the timer.
 */
export function shouldArmQuietSettle(args: {
  force?: boolean;
  promptOriginated: boolean;
  promptInFlight: boolean;
}): boolean {
  if (args.force) {
    return true;
  }
  return args.promptOriginated || args.promptInFlight;
}
