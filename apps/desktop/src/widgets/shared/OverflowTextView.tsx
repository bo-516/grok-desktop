/**
 * Single-line truncated text that reveals the full string in a preformatted
 * popup when the visible line actually overflows. Hover opens it; click pins
 * it (so the parent row does not fire). The tip hugs the cell's bottom-right
 * or top-right corner so it stays close without covering the next row. GitHub-
 * length paths wrap in `<pre>`.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import cs from "classnames";
import {
  isOverflowingX,
  placeOverflowTip,
  type OverflowTipBox,
} from "@/lib/overflowText";

export type OverflowTextViewProps = {
  /** Full string; empty still occupies the grid cell. */
  text: string;
  /** Truncation + color classes from the caller (`palette-label` / `palette-desc`). */
  className: string;
};

/**
 * Truncated cell + optional portaled pre tip.
 * @param props text is what the tip reprints; className must include truncate / ellipsis.
 * @returns Inline span; the tip portals to document.body so list overflow cannot clip it.
 */
export function OverflowTextView(props: OverflowTextViewProps) {
  const { text, className } = props;
  const cellRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<OverflowTipBox | null>(null);

  /**
   * Cancel a pending hover-leave close so the pointer can cross the 4px corner gap.
   */
  const clearCloseTimer = () => {
    if (closeTimerRef.current == null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  useLayoutEffect(() => {
    const el = cellRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      setOverflowing(isOverflowingX(el));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  useLayoutEffect(() => {
    const el = cellRef.current;
    if (!open || !el) {
      return;
    }
    setBox(
      placeOverflowTip(el.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [open, text]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      setPinned(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!pinned) {
      return;
    }
    const onDoc = () => {
      setPinned(false);
      setOpen(false);
    };
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [pinned]);

  useEffect(() => () => clearCloseTimer(), []);

  /**
   * Open the tip on hover only when the line is clipped.
   */
  const onEnter = () => {
    clearCloseTimer();
    if (overflowing) {
      setOpen(true);
    }
  };

  /**
   * Close on leave unless the user pinned the tip with a click.
   * Delayed so the pointer can reach the portaled pre without the tip vanishing.
   */
  const onLeave = () => {
    if (pinned) {
      return;
    }
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  };

  /**
   * Click toggles a pinned tip and blocks the parent palette row.
   * @param e Button-descendant click; stopped only when overflowing.
   */
  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    if (!overflowing) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    setOpen(next);
  };

  const tip =
    open && overflowing && box && text ? (
      <div
        className="overflow-tip"
        role="tooltip"
        style={{
          top: box.top != null ? `${box.top}px` : undefined,
          bottom: box.bottom != null ? `${box.bottom}px` : undefined,
          left: `${box.left}px`,
          maxWidth: `${box.maxWidth}px`,
        }}
        onMouseEnter={() => {
          clearCloseTimer();
          setOpen(true);
        }}
        onMouseLeave={onLeave}
        onClick={(e) => e.stopPropagation()}
      >
        <pre className="overflow-tip-pre">{text}</pre>
      </div>
    ) : null;

  return (
    <>
      <span
        ref={cellRef}
        className={cs(className, { "cursor-help": overflowing })}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
      >
        {text}
      </span>
      {tip && typeof document !== "undefined" && document.body
        ? createPortal(tip, document.body)
        : tip}
    </>
  );
}
