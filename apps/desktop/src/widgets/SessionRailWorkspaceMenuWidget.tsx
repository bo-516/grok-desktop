/**
 * Stateful workspace menu for the session rail footer.
 * Owns open state and dispatches open-panel / reconnect actions.
 * Presentation lives in {@link SessionRailWorkspaceMenuView}.
 */

import { useCallback, useMemo, useState } from "react";
import {
  SessionRailWorkspaceMenuView,
  type WorkspaceMenuActionId,
  type WorkspaceMenuItem,
} from "./SessionRailWorkspaceMenuView";

export type SessionRailWorkspaceMenuWidgetProps = {
  /** Sessions currently streaming (Tasks badge on trigger + menu row). */
  streamingCount: number;
  /** True when connectionMode is live-bridge. */
  live: boolean;
  /** Footer "N running" count (streaming sessions). */
  liveCount: number;
  /** Reconnect / restore the live bridge. */
  onReconnect: () => void;
};

/**
 * Build the static workspace menu rows; Tasks badge is dynamic.
 * @param streamingCount Active stream count for the Tasks row badge.
 * @param live Whether reconnect copy should say Reconnect vs Connect.
 * @returns Menu items for the upward popover.
 */
function buildWorkspaceMenuItems(
  streamingCount: number,
  live: boolean,
): WorkspaceMenuItem[] {
  return [
    { id: "settings", label: "Settings", hint: "⌘," },
    {
      id: "tasks",
      label: "Tasks",
      badge: streamingCount > 0 ? streamingCount : undefined,
    },
    { id: "overview", label: "Overview" },
    { id: "extensions", label: "Extensions" },
    {
      id: "reconnect",
      label: live ? "Reconnect" : "Connect",
      separatorBefore: true,
    },
  ];
}

/**
 * Open a shell side panel by id (settings / tasks / overview / extensions).
 * @param panel Panel detail consumed by useShellChromeEvents open-panel listener.
 */
function openWorkspacePanel(panel: string): void {
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-panel", { detail: panel }),
  );
}

/**
 * Owns menu open state; maps selections to panels or reconnect.
 * @param props Live counts and reconnect handler from SessionRailFooterView.
 * @returns Bound SessionRailWorkspaceMenuView.
 */
export function SessionRailWorkspaceMenuWidget(
  props: SessionRailWorkspaceMenuWidgetProps,
) {
  const { streamingCount, live, liveCount, onReconnect } = props;
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () => buildWorkspaceMenuItems(streamingCount, live),
    [streamingCount, live],
  );

  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen((o) => !o), []);

  /**
   * Run a workspace menu action then close.
   * @param id Action id from SessionRailWorkspaceMenuView.
   */
  const onSelect = useCallback(
    (id: WorkspaceMenuActionId) => {
      setOpen(false);
      if (id === "reconnect") {
        onReconnect();
        return;
      }
      openWorkspacePanel(id);
    },
    [onReconnect],
  );

  return (
    <SessionRailWorkspaceMenuView
      open={open}
      onToggle={onToggle}
      onClose={onClose}
      onSelect={onSelect}
      items={items}
      live={live}
      liveCount={liveCount}
      streamingCount={streamingCount}
    />
  );
}
