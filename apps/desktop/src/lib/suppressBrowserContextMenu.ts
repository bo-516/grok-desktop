/**
 * Suppress the embedded WebView context menu (Reload, Inspect Element).
 *
 * Purpose: a right-click on chrome, lists, or message bodies must not open
 * the browser menu. Those items are WebKit / WebView2 developer chrome, and
 * Wails leaves them visible in dev builds (`IsDebug` returns before it
 * cancels the event).
 *
 * Boundary: enabled text fields and a text selection under the cursor keep
 * the OS edit menu (cut / copy / paste). This module does not draw a
 * replacement menu and does not stop propagation.
 *
 * Phase: the listener sits on `window` in the bubble phase, so it runs
 * after React has dispatched the event. App menus (shadcn / Radix
 * ContextMenu) open only while `event.defaultPrevented` is still false; a
 * capture-phase listener cancels the event before React sees it, and those
 * menus never open. An app handler that calls `stopPropagation()` on
 * `contextmenu` hides the event from this listener and must cancel the
 * browser menu itself.
 *
 * Call once at boot, before React mounts. A second call is a no-op.
 */

/** Window flag so a Vite HMR reload does not stack another listener. */
const INSTALL_FLAG = "__grokSuppressBrowserContextMenu";

/**
 * Input types whose native menu is the OS text-edit menu.
 * Button, checkbox, file, and other non-text types are excluded.
 */
const TEXT_INPUT_TYPES = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

/**
 * Install the bubble-phase listener that cancels the browser context menu.
 *
 * Bubble, not capture: React handlers (and the Radix menus they open) see
 * the event first with `defaultPrevented` still false — see the module note.
 * No `window` (unit tests, non-browser) does nothing. Calling twice does
 * not add a second listener. The listener ignores nothing itself — see
 * `onBrowserContextMenu` for which targets stay uncancelled.
 */
export function installBrowserContextMenuSuppressor(): void {
  if (typeof window === "undefined") {
    return;
  }
  const host = window as Window & { [INSTALL_FLAG]?: boolean };
  if (host[INSTALL_FLAG]) {
    return;
  }
  host[INSTALL_FLAG] = true;
  window.addEventListener("contextmenu", onBrowserContextMenu);
}

/**
 * Cancel the WebView menu unless the target keeps the OS edit menu.
 *
 * `event.target` null, a text node with no element parent, or any
 * non-editing element: the menu is cancelled. An enabled text field,
 * textarea, contenteditable host, or a selection that intersects the
 * target: the menu stays. A disabled field is cancelled.
 */
export function onBrowserContextMenu(event: {
  target: EventTarget | null;
  preventDefault: () => void;
}): void {
  if (nativeEditContextMenuShouldStay(event.target)) {
    return;
  }
  event.preventDefault();
}

/**
 * True when the OS text-editing menu should remain for this right-click.
 *
 * Returns false for a null target, ordinary elements, non-text inputs,
 * and disabled fields. Returns true for an enabled text input, textarea,
 * or contenteditable host, and when the window selection intersects the
 * target (Copy on selected transcript text). A missing `window` or an
 * empty selection does not keep the menu.
 */
export function nativeEditContextMenuShouldStay(target: EventTarget | null): boolean {
  const el = elementFromEventTarget(target);
  if (!el) {
    return false;
  }
  if (isEnabledTextField(el)) {
    return true;
  }
  if (isContentEditableHost(el)) {
    return true;
  }
  return selectionIntersects(el);
}

/**
 * Element under the event. A text node uses its parent element.
 * A target with no `closest` (and no element parent) returns null.
 */
function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") {
    return null;
  }
  const candidate = target as Element;
  if (typeof candidate.closest === "function") {
    return candidate;
  }
  const parent = (target as Node).parentElement;
  if (parent && typeof parent.closest === "function") {
    return parent;
  }
  return null;
}

/**
 * True for an enabled text input or textarea at or above `el`.
 * Disabled fields return false. Non-text inputs (checkbox, file, button)
 * return false. Read-only text fields stay true so Copy remains.
 */
function isEnabledTextField(el: Element): boolean {
  const field = el.closest("input, textarea");
  if (!field || isDisabled(field)) {
    return false;
  }
  const tag = field.tagName.toUpperCase();
  if (tag === "TEXTAREA") {
    return true;
  }
  if (tag !== "INPUT") {
    return false;
  }
  const inputType = "type" in field ? String((field as HTMLInputElement).type) : "text";
  return TEXT_INPUT_TYPES.has(inputType.toLowerCase());
}

/** True when the control exposes the DOM `disabled` flag and it is set. */
function isDisabled(el: Element): boolean {
  return "disabled" in el && Boolean((el as HTMLInputElement).disabled);
}

/**
 * True when `el` is effectively contenteditable, including an ancestor.
 * `contenteditable="false"` is not a host. A missing attribute returns false.
 */
function isContentEditableHost(el: Element): boolean {
  if ("isContentEditable" in el && Boolean((el as HTMLElement).isContentEditable)) {
    return true;
  }
  const host = el.closest("[contenteditable]");
  if (!host || typeof host.getAttribute !== "function") {
    return false;
  }
  const value = (host.getAttribute("contenteditable") ?? "").toLowerCase();
  return value === "" || value === "true" || value === "plaintext-only";
}

/**
 * True when a non-empty window selection intersects `el`.
 * No `window`, a collapsed selection, or `intersectsNode` throwing
 * (node not in the document) returns false.
 */
function selectionIntersects(el: Element): boolean {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  if (selection.toString().length === 0) {
    return false;
  }
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    try {
      if (range.intersectsNode(el)) {
        return true;
      }
    } catch {
      // intersectsNode throws when `el` is not in this document.
    }
  }
  return false;
}
