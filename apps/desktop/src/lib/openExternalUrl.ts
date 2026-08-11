/**
 * Open http(s)/mailto links outside the app shell.
 * Wails webview does not honour target=_blank for system browser; call the
 * Wails Browser.OpenURL runtime when present, otherwise window.open (Vite dev).
 */

/** Schemes allowed for user-triggered external navigation. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Wails v3 runtime object ids (see @wailsio/runtime objectNames / BrowserOpenURL).
 * Browser = 9, OpenURL method = 0.
 */
const WAILS_BROWSER_OBJECT = 9;
const WAILS_BROWSER_OPEN_URL = 0;

/**
 * Validate and normalise a raw href for external open.
 * @param raw Attribute / markdown href; may be empty, relative, or unsafe.
 * @returns Absolute safe URL string, or null when the scheme/host is not allowed.
 */
export function sanitizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    // No base URL: relative paths throw and are rejected on purpose.
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) {
    return null;
  }
  if ((scheme === "http:" || scheme === "https:") && !parsed.hostname) {
    return null;
  }
  return parsed.href;
}

/**
 * Open a URL in the system browser (or a new tab in browser-hosted Vite).
 * @param raw Href from markdown / UI; unsafe values are ignored (returns false).
 * @returns true when an open path was invoked; false when the URL was rejected.
 */
export async function openExternalUrl(raw: string): Promise<boolean> {
  const url = sanitizeExternalUrl(raw);
  if (!url) {
    return false;
  }
  if (await tryWailsOpenUrl(url)) {
    return true;
  }
  // Browser / Vite: new tab. Wails often blocks this; the try above is preferred.
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  return opened != null;
}

/**
 * Call Wails Browser.OpenURL via the asset-server runtime IPC.
 * @param url Already-sanitised absolute URL.
 * @returns true when the runtime accepted the call; false when not in Wails.
 */
async function tryWailsOpenUrl(url: string): Promise<boolean> {
  // Skip the round-trip outside wails:// (and similar) origins.
  if (!looksLikeWailsHost()) {
    return false;
  }
  try {
    const res = await fetch(`${window.location.origin}/wails/runtime`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Client id is required by the runtime gate; value only needs to be stable-ish.
        "x-wails-client-id": "grok-desktop-ui",
      },
      body: JSON.stringify({
        object: WAILS_BROWSER_OBJECT,
        method: WAILS_BROWSER_OPEN_URL,
        args: { url },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Heuristic: Wails serves the UI on wails:// or https://wails.localhost origins.
 * @returns true when we should attempt the Wails runtime OpenURL path.
 */
function looksLikeWailsHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const { protocol, hostname } = window.location;
  if (protocol === "wails:") {
    return true;
  }
  // Windows packaged origin variants seen in the wild.
  if (
    (protocol === "https:" || protocol === "http:") &&
    (hostname === "wails.localhost" || hostname === "wails")
  ) {
    return true;
  }
  return false;
}
