/**
 * Test / fixture helpers for live bridge dispatch (not product path).
 */

import type { SessionUpdate } from "@grok-desktop/acp-core";

/**
 * Build a minimal SessionUpdate list for tests / fixtures (agent chunks).
 * @param n Number of agent_message_chunk updates.
 * @param sessionId Prefix for eventIds.
 * @returns Ordered update + eventId pairs.
 */
export function makeAgentChunkUpdates(
  n: number,
  sessionId = "s1",
): Array<{ update: SessionUpdate; eventId: string }> {
  const out: Array<{ update: SessionUpdate; eventId: string }> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `w${i} ` },
      },
      eventId: `${sessionId}-${i + 1}`,
    });
  }
  return out;
}
