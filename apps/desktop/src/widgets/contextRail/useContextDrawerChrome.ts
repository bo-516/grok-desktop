/**
 * Context-drawer Escape + shared Plan|Agents resize. Local to the drawer
 * widget so focus/width updates do not live on the session store.
 */

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AGENTS_WIDTH_MAX,
  AGENTS_WIDTH_MIN,
  clampAgentsWidth,
  effectiveAgentsFocus,
  nextAgentsDrawerEscape,
  useAgentsPanelStore,
} from "@/store/agentsPanelStore";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Two-level Esc, shared Plan|Agents width, and drag-resize for both tabs.
 * @param args Open flag, active tab, close handler.
 */
export function useContextDrawerChrome(args: {
  open: boolean;
  activeTab: "plan" | "agents";
  onClose: () => void;
}) {
  const { open, activeTab, onClose } = args;
  const storedWidth = useAgentsPanelStore((s) => s.width);
  const setWidth = useAgentsPanelStore((s) => s.setWidth);
  const focusRoster = useAgentsPanelStore((s) => s.focusRoster);
  const focus = useAgentsPanelStore((s) => s.focus);
  const ownerSessionId = useAgentsPanelStore((s) => s.ownerSessionId);
  const viewingSessionId = useSessionStore(
    (s) => s.viewingSessionId ?? s.session.id,
  );
  const effective = effectiveAgentsFocus(
    focus,
    ownerSessionId,
    viewingSessionId || null,
  );

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(storedWidth);

  /** Shared Plan|Agents width — tab switches must not change this value. */
  const drawerWidth = dragWidth ?? storedWidth;

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Escape" || !open) {
        return;
      }
      e.stopPropagation();
      const action = nextAgentsDrawerEscape({
        open,
        rail: activeTab,
        effectiveFocus: effective,
      });
      if (action === "roster") {
        focusRoster();
        return;
      }
      if (action === "close") {
        onClose();
      }
    },
    [open, activeTab, effective, focusRoster, onClose],
  );

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = drawerWidth;
    setDragWidth(drawerWidth);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth == null) {
      return;
    }
    const delta = dragStartX.current - e.clientX;
    setDragWidth(clampAgentsWidth(dragStartW.current + delta));
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth == null) {
      return;
    }
    setWidth(dragWidth);
    setDragWidth(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  return {
    drawerWidth,
    agentsMin: AGENTS_WIDTH_MIN,
    agentsMax: AGENTS_WIDTH_MAX,
    onKeyDown,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  };
}
