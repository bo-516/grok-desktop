/**
 * Focus helpers for modal shells (side panel, confirm dialog).
 *
 * Purpose: list tab-reachable controls and cycle Tab/Shift+Tab inside a root
 * so aria-modal overlays do not leak focus into the dimmed page.
 * Boundary: pure DOM utilities — no React. Callers own open/close lifecycle
 * and must pass a live root element; a detached root yields an empty list.
 */

/** Tab-order candidates inside a modal root (buttons, links, fields). */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether an element can receive keyboard focus and is painted.
 * @param el Candidate node from querySelectorAll
 * @returns false when inert, aria-hidden, display/visibility hidden, or zero-box
 */
export function isFocusableVisible(el: HTMLElement): boolean {
  if (el.closest("[inert]")) {
    return false;
  }
  if (el.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  return el.getClientRects().length > 0;
}

/**
 * Collect visible focusable elements under root in document order.
 * @param root Modal container; null/undefined yields []
 * @returns Focusable HTMLElements suitable for Tab cycling
 */
export function listFocusable(
  root: ParentNode | null | undefined,
): HTMLElement[] {
  if (!root) {
    return [];
  }
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return nodes.filter(isFocusableVisible);
}

/**
 * Cycle Tab / Shift+Tab within root; no-op for other keys.
 * When the list is empty, focuses the root (must be tabIndex=-1 capable).
 * @param event Keyboard event — only Tab is handled
 * @param root Trap container (dialog / alertdialog element)
 * @returns true when the event was prevented and focus was moved
 */
export function trapFocusTab(
  event: KeyboardEvent,
  root: HTMLElement,
): boolean {
  if (event.key !== "Tab") {
    return false;
  }
  const list = listFocusable(root);
  if (list.length === 0) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !root.contains(active);
  if (event.shiftKey) {
    if (outside || active === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }
  if (outside || active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Move focus into root: first focusable control, else the root itself.
 * @param root Dialog element; ignored when null
 */
export function focusInitialIn(root: HTMLElement | null): void {
  if (!root) {
    return;
  }
  const first = listFocusable(root)[0];
  if (first) {
    first.focus();
    return;
  }
  root.focus();
}

/**
 * Restore focus to a prior element when it is still connected.
 * @param el Element that held focus before the modal opened
 */
export function restoreFocus(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.focus !== "function") {
    return;
  }
  if (!el.isConnected) {
    return;
  }
  el.focus();
}
