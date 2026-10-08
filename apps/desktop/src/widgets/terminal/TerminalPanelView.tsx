/**
 * Terminal dock chrome (Stateless): resize edge, tab strip, new / hide
 * buttons, and the body that hosts one pane per tab (passed as children so
 * the stateful xterm hosts stay owned by the widget).
 */

import cs from "classnames";
import { ChevronDown, Plus, SquareTerminal, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TerminalDockResizeHandlers } from "./useTerminalDockResize";

/** What the strip shows for one tab. */
export type TerminalTabViewModel = {
  /** Tab key (Radix value). */
  key: string;
  /** Visible label (shell title or `shell · folder`). */
  label: string;
  /** Tooltip: cwd and, once ended, the exit detail. */
  tooltip: string;
  /** True once the shell exited / failed (label dims). */
  ended: boolean;
};

/** Props of {@link TerminalPanelView}. */
export type TerminalPanelViewProps = {
  /** Dock visible; when false it stays mounted but takes no space. */
  open: boolean;
  /** Dock height in px. */
  height: number;
  /** Resize drag in progress (handle highlight). */
  dragging: boolean;
  /** Pointer handlers for the resize edge. */
  resizeHandlers: TerminalDockResizeHandlers;
  /** Tabs in strip order. */
  tabs: TerminalTabViewModel[];
  /** Selected tab key; null without tabs. */
  activeKey: string | null;
  /** False while the bridge is offline (new-tab button disabled). */
  canCreate: boolean;
  /** Body text when there is nothing to show (offline / no tabs); null otherwise. */
  emptyMessage: string | null;
  /** Toggle chord label for tooltips (`⌘J` / `Ctrl+J`). */
  toggleHint: string;
  /** Select a tab. */
  onSelect: (key: string) => void;
  /** Close a tab (kills its shell). */
  onClose: (key: string) => void;
  /** Open another terminal. */
  onNew: () => void;
  /** Hide the dock. */
  onHide: () => void;
  /** One TabsContent pane per tab. */
  children: ReactNode;
};

/**
 * Render the dock.
 * @param props See {@link TerminalPanelViewProps}.
 * @returns The dock section (hidden via class when closed).
 */
export function TerminalPanelView(props: TerminalPanelViewProps) {
  const {
    open,
    height,
    dragging,
    resizeHandlers,
    tabs,
    activeKey,
    canCreate,
    emptyMessage,
    toggleHint,
    onSelect,
    onClose,
    onNew,
    onHide,
    children,
  } = props;
  return (
    <section
      className={cs("terminal-dock", { "terminal-dock-closed": !open })}
      style={{ height }}
      aria-label="Terminal"
      data-open={open ? "true" : "false"}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        aria-valuenow={height}
        className={cs("terminal-resize-handle", {
          "terminal-resize-handle-active": dragging,
        })}
        {...resizeHandlers}
      />
      <Tabs
        value={activeKey ?? ""}
        onValueChange={onSelect}
        className="flex-1 min-h-0 gap-0"
      >
        <div className="terminal-head">
          <TabsList
            aria-label="Terminals"
            className="h-7 min-w-0 flex-1 justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none bg-transparent p-0"
          >
            {tabs.map((tab) => (
              <div key={tab.key} className="group terminal-tab">
                <TabsTrigger
                  value={tab.key}
                  title={tab.tooltip}
                  className={cs("h-7 min-w-0 flex-none justify-start pr-1", {
                    "text-fg-faint": tab.ended,
                  })}
                >
                  <SquareTerminal size={13} aria-hidden />
                  <span className="terminal-tab-label">{tab.label}</span>
                </TabsTrigger>
                <button
                  type="button"
                  className={cs("terminal-tab-close", {
                    "terminal-tab-close-visible": tab.key === activeKey,
                  })}
                  aria-label={`Close ${tab.label}`}
                  title="Close terminal"
                  onClick={() => onClose(tab.key)}
                >
                  <XIcon size={12} aria-hidden />
                </button>
              </div>
            ))}
          </TabsList>
          <button
            type="button"
            className="terminal-icon-btn"
            aria-label="New terminal"
            title="New terminal"
            disabled={!canCreate}
            onClick={onNew}
          >
            <Plus size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="terminal-icon-btn"
            aria-label="Hide terminal"
            title={`Hide terminal (${toggleHint})`}
            onClick={onHide}
          >
            <ChevronDown size={15} aria-hidden />
          </button>
        </div>
        <div className="terminal-body">
          {emptyMessage ? <div className="terminal-empty">{emptyMessage}</div> : null}
          {children}
        </div>
      </Tabs>
    </section>
  );
}
