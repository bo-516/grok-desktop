/**
 * Shared connection types for live bridge store modules.
 * Kept tiny so inbound + start modules can import without cycles.
 */

import type { connectLiveBridge } from "../bridge/liveBridge";

export type ConnectionMode = "live-bridge" | "disconnected" | "connecting";

/** Live bridge client handle returned by connectLiveBridge. */
export type LiveHandle = ReturnType<typeof connectLiveBridge>;
