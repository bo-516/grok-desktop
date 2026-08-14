/**
 * Keyboard reveal math for the composer `@` / `/` list.
 * The panel is `max-h-80 overflow-y-auto`; ArrowUp/Down must keep the
 * active row inside that port. Only `scrollTop` on the list is written —
 * never the page or timeline (ancestor scrollports must stay put).
 */

/**
 * Next scrollTop that keeps an item fully inside the scrollport.
 * Returns the same `scrollTop` when the item is already fully visible
 * (hover, first paint, and in-view arrow steps must not jump).
 * A row taller than the port aligns to `portTop` so the title stays on screen.
 * @param portTop Viewport top of the overflow container.
 * @param portBottom Viewport bottom of the overflow container.
 * @param itemTop Viewport top of the active row.
 * @param itemBottom Viewport bottom of the active row.
 * @param scrollTop Current scrollTop of the overflow container.
 * @returns Next scrollTop; identical to `scrollTop` when no move is needed.
 */
export function scrollTopToRevealItem(
  portTop: number,
  portBottom: number,
  itemTop: number,
  itemBottom: number,
  scrollTop: number,
): number {
  if (itemTop < portTop) {
    return scrollTop - (portTop - itemTop);
  }
  if (itemBottom > portBottom) {
    return scrollTop + (itemBottom - portBottom);
  }
  return scrollTop;
}

/**
 * Measure the active option and `#composer-suggestions`, then write only
 * `scrollTop` on that port. Missing `el` / port is a no-op so a ref detach
 * cannot throw; a missing port id would leave the highlight off-screen.
 * @param el Active option element, or null when the callback ref detaches.
 */
export function revealActiveSuggestion(el: HTMLButtonElement | null): void {
  if (!el) {
    return;
  }
  const port = el.closest("#composer-suggestions");
  if (!(port instanceof HTMLElement)) {
    return;
  }
  const portRect = port.getBoundingClientRect();
  const itemRect = el.getBoundingClientRect();
  const next = scrollTopToRevealItem(
    portRect.top,
    portRect.bottom,
    itemRect.top,
    itemRect.bottom,
    port.scrollTop,
  );
  if (next !== port.scrollTop) {
    port.scrollTop = next;
  }
}
