/**
 * Open the current (or a chosen) session in a second window.
 *
 * Wails: POST {@link SESSION_WINDOW_PATH} so the shell calls
 * Window.NewWithOptions. The new webview loads `/?session=<id>` and gets the
 * same bridge-URL head injection as the first window.
 * Vite / a normal browser: `window.open` on that same path. Each window is
 * its own UI instance and its own WebSocket to the bridge.
 *
 * Session ids are restricted to the same alphabet the shell accepts, so a
 * crafted id cannot change the asset path.
 */

import { displaySessionTitle } from "@grok-desktop/acp-core";
import { isWailsShellHost } from "@/lib/openExternalUrl";

/** Asset path the shell handles. Must match apps/shell SessionWindowPath. */
export const SESSION_WINDOW_PATH = "/__grok_desktop_window";

/** Query key naming the session. Must match the shell's session query param. */
export const SESSION_WINDOW_QUERY = "session";

/**
 * Window event that asks the session-window widget to open a session.
 * Detail may name a row; omitted detail uses the session on the canvas.
 */
export const OPEN_SESSION_WINDOW_EVENT = "grok-desktop:open-session-window";

/** Optional detail for {@link OPEN_SESSION_WINDOW_EVENT}. */
export type OpenSessionWindowDetail = {
  /** Catalog / ACP session id. Omitted uses the viewed session. */
  sessionId?: string;
  /** Title to put on the new window. Omitted uses the catalog title. */
  title?: string;
};

/** Title used when no session is on the canvas. */
export const DEFAULT_WINDOW_TITLE = "Grok Desktop";

/** Longest session id the shell will accept, in characters (ASCII ids). */
const SESSION_ID_MAX = 200;

/**
 * What the shell should do on cold boot when the URL may name a session.
 * `wait-pinned` means the id is not in the catalog yet — do not open a
 * different chat while the list is still arriving.
 */
export type BootOpenDecision =
  | "already-open"
  | "wait-pinned"
  | "select-pinned"
  | "open-newest";

/** Result of asking the shell or the browser to open a session window. */
export type SessionWindowOpenResult =
  | { ok: true; via: "shell" | "browser"; created?: boolean }
  | { ok: false; reason: "invalid" | "shell" };

/**
 * Overrides for {@link openSessionInNewWindow} and {@link pushNativeWindowTitle}.
 * Tests pass these so they do not touch a real window or network.
 */
export type SessionWindowIO = {
  /** True when the page is the Wails asset host. */
  shellHost?: boolean;
  /** Origin for the POST, without a trailing slash. */
  origin?: string;
  /** POST implementation. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Browser fallback. Receives a root-relative or absolute URL. */
  openImpl?: (url: string) => void;
};

/**
 * Whether id is safe to place in the session query and the Wails window name.
 * Same alphabet as the shell: letters, digits, and `._:-`.
 * @param id Raw session id. Empty and over-long values are rejected.
 * @returns True when the shell would accept this id.
 */
export function isSessionWindowId(id: string): boolean {
  if (!id || id.length > SESSION_ID_MAX) {
    return false;
  }
  for (let i = 0; i < id.length; i += 1) {
    const code = id.charCodeAt(i);
    const digit = code >= 48 && code <= 57;
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    const mark =
      id[i] === "-" || id[i] === "_" || id[i] === "." || id[i] === ":";
    if (!digit && !upper && !lower && !mark) {
      return false;
    }
  }
  return true;
}

/**
 * Read the session id a window was opened for.
 * @param search `location.search`, with or without the leading `?`. Empty
 *   when this is the primary window.
 * @returns The id, or null when the param is missing or not a safe id.
 */
export function readBootSessionId(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const id = new URLSearchParams(raw).get(SESSION_WINDOW_QUERY) ?? "";
  if (!isSessionWindowId(id)) {
    return null;
  }
  return id;
}

/**
 * Asset path a session window loads. Query encoding matches Go's url.Values
 * (application/x-www-form-urlencoded) so both sides agree on the URL.
 * @param sessionId Session to show. Invalid ids return null — do not navigate.
 * @returns `/?session=<id>` or null.
 */
export function sessionWindowPath(sessionId: string): string | null {
  if (!isSessionWindowId(sessionId)) {
    return null;
  }
  const query = new URLSearchParams();
  query.set(SESSION_WINDOW_QUERY, sessionId);
  return `/?${query.toString()}`;
}

/**
 * Choose the cold-open action for this window.
 * A pinned id that is not in the catalog yet must wait: falling through to
 * the newest chat would show the wrong session in a window opened for another.
 * @param args Boot id from the URL, catalog ids already loaded, and whether
 *   the user already has a canvas (draft or a selected session).
 * @returns The decision the shell lifecycle effect should apply.
 */
export function decideBootOpen(args: {
  /** Id from {@link readBootSessionId}, or null on the primary window. */
  bootSessionId: string | null;
  /** Ids currently in the catalog (disk hydrate and live list). */
  catalogIds: readonly string[];
  /** Session the user is already looking at, if any. */
  viewingSessionId: string | null;
  /** True when New chat is the canvas and must not be replaced. */
  localDraft: boolean;
}): BootOpenDecision {
  const viewing = args.viewingSessionId?.trim() ?? "";
  if (args.localDraft || viewing) {
    return "already-open";
  }
  if (args.bootSessionId) {
    if (args.catalogIds.includes(args.bootSessionId)) {
      return "select-pinned";
    }
    return "wait-pinned";
  }
  return "open-newest";
}

/**
 * Native / document title for a session window.
 * No session stays "Grok Desktop". A session with a weak or empty title uses
 * the same fallback as the rail (`Untitled chat`).
 * @param raw Catalog or canvas title. May be undefined on a blank draft.
 * @param hasSession True when a session id is on the canvas or the request.
 * @returns A single-line title safe to show in the title bar.
 */
export function formatSessionWindowTitle(
  raw: string | undefined,
  hasSession: boolean,
): string {
  if (!hasSession) {
    return DEFAULT_WINDOW_TITLE;
  }
  return displaySessionTitle(raw) || DEFAULT_WINDOW_TITLE;
}

/**
 * Menu hint for the open-in-window shortcut (⌘⇧N / Ctrl+Shift+N).
 * The key is bound in the shell; this string is display only.
 * @param platform `navigator.platform` or a user-agent fragment. Mac-like
 *   values get the command glyph.
 * @returns The hint text.
 */
export function sessionWindowShortcutLabel(platform: string): string {
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) {
    return "⌘⇧N";
  }
  return "Ctrl+Shift+N";
}

/**
 * Pick which session an open request refers to, and the title to send.
 * An explicit detail id wins; otherwise the viewed session, then the canvas.
 * Returns null when no safe id is available (empty New chat) so the caller
 * does not open a blank window.
 * @param input Detail from the event plus a snapshot of the store.
 * @returns The id and title, or null when there is nothing to open.
 */
export function resolveSessionWindowTarget(input: {
  /** Detail session id. Empty means "the session on screen". */
  requestedId?: string;
  /** Detail title. Empty means look up the catalog / canvas title. */
  requestedTitle?: string;
  /** Store viewingSessionId. */
  viewingSessionId: string | null;
  /** Store session.id (empty on a draft). */
  canvasSessionId: string;
  /** Store session.title for the canvas session. */
  canvasTitle: string;
  /**
   * Catalog title for an id, already display-ready.
   * @param id Session id that was chosen.
   * @returns Title, or undefined when the row is not in the catalog.
   */
  titleForId: (id: string) => string | undefined;
}): { sessionId: string; title: string } | null {
  const requested = input.requestedId?.trim() ?? "";
  const viewing = input.viewingSessionId?.trim() ?? "";
  const canvas = input.canvasSessionId.trim();
  const sessionId = requested || viewing || canvas;
  if (!isSessionWindowId(sessionId)) {
    return null;
  }
  const explicit = input.requestedTitle?.trim() ?? "";
  const fromCatalog = input.titleForId(sessionId)?.trim() ?? "";
  const fromCanvas = canvas === sessionId ? input.canvasTitle : "";
  const raw = explicit || fromCatalog || fromCanvas;
  return {
    sessionId,
    title: formatSessionWindowTitle(raw, true),
  };
}

/**
 * Ask the shell (or the browser) to show sessionId in another window.
 * Invalid ids do nothing. In the shell, a window that already shows this
 * session is focused (`created: false`) instead of duplicated.
 * @param sessionId Session to open. Must pass {@link isSessionWindowId}.
 * @param title Native title. Sanitized again by the shell.
 * @param io Optional fetch / open overrides. Omitted uses the real page.
 * @returns Whether an open was accepted. `reason: "invalid"` means the id
 *   was rejected locally; `reason: "shell"` means the POST failed.
 */
export async function openSessionInNewWindow(
  sessionId: string,
  title: string,
  io?: SessionWindowIO,
): Promise<SessionWindowOpenResult> {
  const path = sessionWindowPath(sessionId);
  if (!path) {
    return { ok: false, reason: "invalid" };
  }
  const shellHost = io?.shellHost ?? isWailsShellHost();
  const safeTitle = formatSessionWindowTitle(title, true);
  if (shellHost) {
    const posted = await postSessionWindow(
      { op: "open", sessionId, title: safeTitle },
      io,
    );
    if (!posted.ok) {
      return { ok: false, reason: "shell" };
    }
    return { ok: true, via: "shell", created: posted.created };
  }
  const openImpl = io?.openImpl ?? defaultBrowserOpen;
  const href = io?.origin ? `${io.origin}${path}` : path;
  openImpl(href);
  return { ok: true, via: "browser" };
}

/**
 * Set this window's native title when running inside Wails.
 * The asset server stamps `x-wails-window-id` on the request, so the shell
 * retitles the window that asked and not the first window. Outside Wails
 * this is a no-op (the caller also sets `document.title`).
 * @param title Next title. Blank becomes {@link DEFAULT_WINDOW_TITLE}.
 * @param io Optional fetch override.
 * @returns True when the shell accepted the title.
 */
export async function pushNativeWindowTitle(
  title: string,
  io?: SessionWindowIO,
): Promise<boolean> {
  const shellHost = io?.shellHost ?? isWailsShellHost();
  if (!shellHost) {
    return false;
  }
  const safeTitle = title.trim() || DEFAULT_WINDOW_TITLE;
  const posted = await postSessionWindow({ op: "set_title", title: safeTitle }, io);
  return posted.ok;
}

/**
 * POST one session-window op. Network and JSON failures return ok: false
 * and do not throw — a title sync must not break the shell.
 * @param body Open or set_title payload.
 * @param io Origin and fetch override.
 * @returns ok plus the shell's `created` flag when the body parsed.
 */
async function postSessionWindow(
  body: { op: "open" | "set_title"; sessionId?: string; title: string },
  io: SessionWindowIO | undefined,
): Promise<{ ok: boolean; created?: boolean }> {
  const origin =
    io?.origin ??
    (typeof window === "undefined" ? "" : window.location.origin);
  const fetchImpl = io?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${origin}${SESSION_WINDOW_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false };
    }
    try {
      const parsed = (await res.json()) as { created?: boolean };
      return { ok: true, created: parsed.created };
    } catch {
      return { ok: true };
    }
  } catch {
    return { ok: false };
  }
}

/**
 * Open a root-relative URL in a new browser tab. Used only outside Wails.
 * A missing `window` (unit tests that forgot openImpl) does nothing.
 * @param url Path or absolute URL.
 */
function defaultBrowserOpen(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
