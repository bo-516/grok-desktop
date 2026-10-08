/**
 * Ref-owned xterm mount for one terminal tab (Stateful: owns the xterm
 * instance via useXtermHost). Memoized so dock re-renders (drag, tab
 * switches) do not re-run its effects with fresh props unless they changed.
 */

import "@xterm/xterm/css/xterm.css";
import { memo } from "react";
import { useXtermHost, type XtermHostOptions } from "./useXtermHost";

/** Props: exactly the xterm host options. */
export type XtermHostWidgetProps = XtermHostOptions;

/**
 * Render the mount node; xterm fills it.
 * @param props Terminal id, bridge channel, visibility, appearance, callbacks.
 * @returns A sized block xterm renders into.
 */
function XtermHostWidgetImpl(props: XtermHostWidgetProps) {
  const hostRef = useXtermHost(props);
  return <div ref={hostRef} className="terminal-xterm-host" />;
}

export const XtermHostWidget = memo(XtermHostWidgetImpl);
