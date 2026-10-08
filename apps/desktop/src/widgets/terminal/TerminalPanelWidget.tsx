/**
 * Integrated terminal dock (Stateful): bottom panel under the composer with
 * one PTY shell per tab, toggled by ⌘J / Ctrl+J. Thin assembly over
 * useTerminalPanelWidget; xterm instances live in XtermHostWidget and stay
 * mounted while their tab is hidden or the dock is closed, so scrollback and
 * running programs survive.
 */

import { TabsContent } from "@/components/ui/tabs";
import { isMacPlatform } from "@/lib/terminalKeys";
import { terminalTabLabel, type TerminalTab } from "@/lib/terminalTabs";
import { TerminalPanelView, type TerminalTabViewModel } from "./TerminalPanelView";
import { useTerminalPanelWidget } from "./useTerminalPanelWidget";
import { XtermHostWidget } from "./XtermHostWidget";

/** Toggle chord label shown in tooltips. */
const TOGGLE_HINT = isMacPlatform(typeof navigator === "undefined" ? null : navigator)
  ? "⌘J"
  : "Ctrl+J";

/**
 * Strip view model for one tab.
 * @param tab Widget tab state.
 * @returns Label, tooltip (cwd + exit detail) and ended flag.
 */
function toTabViewModel(tab: TerminalTab): TerminalTabViewModel {
  const where = tab.info?.cwd ?? tab.requestedCwd ?? "";
  const tooltip = [where, tab.detail].filter(Boolean).join("\n");
  return {
    key: tab.key,
    label: terminalTabLabel(tab),
    tooltip,
    ended: tab.status === "exited" || tab.status === "failed",
  };
}

/**
 * Body message when no pane is shown.
 * @param hasTabs Whether any tab exists.
 * @param canCreate Whether the bridge is connected.
 * @returns Message, or null when panes are shown.
 */
function emptyMessage(hasTabs: boolean, canCreate: boolean): string | null {
  if (hasTabs) {
    return null;
  }
  return canCreate
    ? "Starting terminal…"
    : "Bridge disconnected — reconnect to open a terminal.";
}

/**
 * Terminal dock for the main column.
 * @returns The dock (always mounted; hidden while closed).
 */
export function TerminalPanelWidget() {
  const dock = useTerminalPanelWidget();
  return (
    <TerminalPanelView
      open={dock.open}
      height={dock.height}
      dragging={dock.dragging}
      resizeHandlers={dock.resizeHandlers}
      tabs={dock.tabs.map(toTabViewModel)}
      activeKey={dock.activeKey}
      canCreate={dock.canCreate}
      emptyMessage={emptyMessage(dock.tabs.length > 0, dock.canCreate)}
      toggleHint={TOGGLE_HINT}
      onSelect={dock.selectTab}
      onClose={dock.closeTab}
      onNew={dock.newTab}
      onHide={dock.hide}
    >
      {dock.tabs.map((tab) => (
        <TabsContent
          key={tab.key}
          value={tab.key}
          forceMount
          className="terminal-pane data-[state=inactive]:hidden"
        >
          {tab.status === "failed" ? (
            <div className="terminal-empty">{tab.detail || "Terminal failed to start."}</div>
          ) : (
            <XtermHostWidget
              tabKey={tab.key}
              terminalId={tab.terminalId}
              api={tab.api}
              visible={dock.open && tab.key === dock.activeKey}
              theme={dock.appearance.theme}
              fontFamily={dock.appearance.fontFamily}
              fontEpoch={dock.appearance.fontEpoch}
              onReady={dock.onReady}
              onExit={dock.onExit}
              onTitle={dock.onTitle}
            />
          )}
        </TabsContent>
      ))}
    </TerminalPanelView>
  );
}
