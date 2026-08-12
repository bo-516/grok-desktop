/**
 * Stateful workspace menu for the session rail footer.
 * Owns open state and dispatches open-panel / reconnect actions.
 * Presentation (density quota + chip + menu) lives in
 * {@link SessionRailWorkspaceMenuView}; open suppresses quota paint so the
 * light track cannot show under the upward popover.
 */

import { useCallback, useMemo, useState } from "react";
import {
  SessionRailWorkspaceMenuView,
  type WorkspaceMenuActionId,
  type WorkspaceMenuItem,
} from "./SessionRailWorkspaceMenuView";

export type SessionRailWorkspaceMenuWidgetProps = {
  /** Catalog size for the density bar and "Sessions" label. */
  catalogLength: number;
  /** Sessions currently streaming (Overview badge on trigger + menu row). */
  streamingCount: number;
  /** True when connectionMode is live-bridge. */
  live: boolean;
  /** Footer "N running" count (streaming sessions). */
  liveCount: number;
  /** Reconnect / restore the live bridge. */
  onReconnect: () => void;
};

/**
 * Build the static workspace menu rows; Overview badge is the cross-session
 * streaming count (data scope matches the Overview panel).
 * @param streamingCount Active stream count for the Overview row badge.
 * @param live Whether reconnect copy should say Reconnect vs Connect.
 * @returns Menu items for the upward popover (no session-scoped Tasks).
 */
function buildWorkspaceMenuItems(
  streamingCount: number,
  live: boolean,
): WorkspaceMenuItem[] {
  return [
    { id: "settings", label: "Settings", hint: "⌘," },
    {
      id: "overview",
      label: "Overview",
      badge: streamingCount > 0 ? streamingCount : undefined,
    },
    { id: "environment", label: "Environment…" },
    {
      id: "reconnect",
      label: live ? "Reconnect" : "Connect",
      separatorBefore: true,
    },
  ];
}

/**
 * Open a shell panel by id (settings / overview / environment).
 * Environment uses the dedicated open-environment event so the sheet lands
 * on Overview; other panels use open-panel.
 * @param panel Panel detail consumed by useShellChromeEvents.
 */
function openWorkspacePanel(panel: string): void {
  if (panel === "environment") {
    window.dispatchEvent(
      new CustomEvent("grok-desktop:open-environment", { detail: "overview" }),
    );
    return;
  }
  window.dispatchEvent(
    new CustomEvent("grok-desktop:open-panel", { detail: panel }),
  );
}

/**
 * Owns menu open state; maps selections to panels or reconnect.
 * @param props Catalog length, live counts, and reconnect handler from
 *   SessionRailFooterView — missing catalogLength zeros the density fill.
 * @returns Bound SessionRailWorkspaceMenuView (quota + chip + menu).
 */
export function SessionRailWorkspaceMenuWidget(
  props: SessionRailWorkspaceMenuWidgetProps,
) {
  const { catalogLength, streamingCount, live, liveCount, onReconnect } =
    props;
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
      catalogLength={catalogLength}
    />
  );
}
