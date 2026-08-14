/**
 * Stateful session rail: store + prefs + filter via useSessionRailWidget,
 * pure presentation via SessionRailView.
 */

import {
  SessionRailView,
} from "./SessionRailView";
import {
  useSessionRailWidget,
  type SessionRailWidgetProps,
} from "./useSessionRailWidget";

/**
 * Mount point for the left session list.
 * @param props Optional delete confirm, overlay open, and header collapse.
 * @returns Rail bound to the live session catalog.
 */
export function SessionRailWidget(props: SessionRailWidgetProps = {}) {
  const model = useSessionRailWidget(props);
  return <SessionRailView {...model} />;
}

export type { SessionRailWidgetProps };
