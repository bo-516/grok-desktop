/**
 * Account-level weekly remaining fetch via grok-build `_x.ai/billing`.
 * Purpose: one in-flight request, last-known-good snapshot, no session restart.
 * Boundary: does not invent zeros — parse failure keeps the previous snapshot.
 */

import { parseBillingResponse } from "@grok-desktop/acp-core";
import type { WeeklyUsageOutcome } from "@/lib/weeklyUsagePoll";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/** Module-level lock so overlapping hook refreshes do not stack RPCs. */
let billingInFlight = false;

/**
 * Fetch `_x.ai/billing` on the live session process and store the snapshot.
 * Silent on disconnect / missing session / in-flight / parse failure.
 * @param set Zustand set — writes `weeklyUsage` only when a new snapshot parses.
 * @param get Zustand get — needs live handle + a resident session id.
 * @returns Poll pacing hint: `skip` when there was nothing to ask, `fail` when
 * the RPC errored or the bag did not parse, `ok` when a snapshot landed.
 */
export async function refreshWeeklyUsageAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<WeeklyUsageOutcome> {
  if (billingInFlight) {
    return "skip";
  }
  const live = get().live;
  const sid =
    get().session.id || get().activeSessionId || get().viewingSessionId;
  if (!live || get().connectionMode !== "live-bridge" || !sid) {
    return "skip";
  }
  billingInFlight = true;
  try {
    const result = await live.billing(sid);
    if (!result.ok) {
      return "fail";
    }
    const snap = parseBillingResponse(result.data);
    if (!snap) {
      return "fail";
    }
    set({ weeklyUsage: snap });
    return "ok";
  } catch {
    // Transport timeout / method-not-found — keep last-known-good.
    return "fail";
  } finally {
    billingInFlight = false;
  }
}
