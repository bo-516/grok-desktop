/**
 * Open the Agents companion on a child without touching the main canvas.
 * The only inspect entry used by the roster and the L1 group.
 */

import { openAppRail } from "@/lib/commandPalette";
import { useAgentsPanelStore } from "@/store/agentsPanelStore";

/**
 * Focus a child in the Agents drawer and open the Agents tab.
 * Does not call selectSession — the viewing session stays the parent.
 * @param childSessionId Child ACP session id from the subagent card.
 * @param ownerSessionId Current viewing / parent session id.
 */
export function inspectSubagentInPanel(
  childSessionId: string,
  ownerSessionId: string,
): void {
  const id = childSessionId.trim();
  if (!id) {
    return;
  }
  useAgentsPanelStore.getState().focusSubagent(id, ownerSessionId);
  openAppRail("agents");
}
