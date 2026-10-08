/**
 * Drag-to-resize for the terminal dock's top edge, plus the viewport clamp.
 * Height lives in React state (the dock renders it); pointer capture keeps
 * the drag alive when the cursor leaves the 6px handle.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { clampTerminalPanelHeight } from "@/lib/terminalPanelPrefs";

/** Pointer handlers spread onto the resize handle. */
export type TerminalDockResizeHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
};

/** Result of {@link useTerminalDockResize}. */
export type TerminalDockResize = {
  /** Height to render, clamped to the current viewport. */
  height: number;
  /** True while the user drags the handle. */
  dragging: boolean;
  /** Handlers for the handle element. */
  handlers: TerminalDockResizeHandlers;
};

/**
 * Resize state for the dock.
 * @param storedHeight Preferred height (prefs); the user's drag commits here.
 * @param commitHeight Persist a new preferred height (called on drag end).
 * @returns Clamped height, drag flag and handle handlers.
 */
export function useTerminalDockResize(
  storedHeight: number,
  commitHeight: (height: number) => void,
): TerminalDockResize {
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  /** Active drag origin plus the latest height it produced; null when idle. */
  const drag = useRef<{ startY: number; startHeight: number; lastHeight: number } | null>(
    null,
  );
  const height = clampTerminalPanelHeight(dragHeight ?? storedHeight, viewport);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startY: e.clientY, startHeight: height, lastHeight: height };
      setDragHeight(height);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active) {
        return;
      }
      // Dragging up (smaller clientY) grows the dock.
      active.lastHeight = clampTerminalPanelHeight(
        active.startHeight + (active.startY - e.clientY),
        viewport,
      );
      setDragHeight(active.lastHeight);
    },
    [viewport],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active) {
        return;
      }
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      commitHeight(active.lastHeight);
      setDragHeight(null);
    },
    [commitHeight],
  );

  return {
    height,
    dragging: dragHeight !== null,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
  };
}
