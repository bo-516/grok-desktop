/**
 * Integrated terminal feature barrel — bottom dock with PTY shells from the
 * bridge (`terminal_*` protocol), toggled by ⌘J / Ctrl+J.
 */

export { TerminalPanelWidget } from "./TerminalPanelWidget";
export {
  useTerminalPanelWidget,
  type TerminalPanelWidgetModel,
} from "./useTerminalPanelWidget";
