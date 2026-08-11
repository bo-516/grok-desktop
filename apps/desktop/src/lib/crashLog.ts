/**
 * Frontend crash / boot logger.
 *
 * Purpose: capture render failures and uncaught errors so a black WebView is
 * diagnosable. Writes to console + localStorage ring, and POSTs to the shell
 * asset endpoint (`window.__GROK_UI_LOG_PATH__`) when running inside Wails.
 *
 * Boundary: never throws to callers. Network failures are swallowed after a
 * console.warn. localStorage may be unavailable (private mode) — also ignored.
 */

/** One persisted crash/boot record kept for the next session. */
export type CrashLogEntry = {
  /** Unix ms when the event was recorded. */
  at: number;
  /** error | warn | info */
  level: string;
  /** Short message. */
  message: string;
  /** Optional stack / component stack. */
  stack?: string;
  /** Emitter tag (boot, boundary, window.onerror, …). */
  source?: string;
};

/** localStorage key for the last few crash records (survives reload). */
export const CRASH_LOG_STORAGE_KEY = "grok-desktop.crash-log.v1";

/** Max entries kept in the localStorage ring. */
const CRASH_LOG_RING = 20;

declare global {
  interface Window {
    /** Injected by shell: absolute log directory on disk. */
    __GROK_LOG_DIR__?: string;
    /** Injected by shell: same-origin path for POST crash reports. */
    __GROK_UI_LOG_PATH__?: string;
  }
}

/**
 * Resolve the UI log POST path (shell inject or default for Wails asset server).
 * @returns Path string, or empty when we should not attempt a network log.
 */
export function uiLogPath(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const injected = window.__GROK_UI_LOG_PATH__?.trim();
  if (injected) {
    return injected;
  }
  // Packaged shell always serves this; harmless 404 on plain Vite web if unused.
  return "/__grok_desktop_log";
}

/**
 * Absolute log directory from shell inject, for error UI copy.
 * @returns Path or empty string.
 */
export function logDirHint(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.__GROK_LOG_DIR__?.trim() ?? "";
}

/**
 * Append one crash/boot entry to localStorage (ring buffer).
 * @param entry Record to store; wrong/missing fields still store best-effort.
 */
export function persistCrashLocally(entry: CrashLogEntry): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const raw = localStorage.getItem(CRASH_LOG_STORAGE_KEY);
    const prev: CrashLogEntry[] = raw ? (JSON.parse(raw) as CrashLogEntry[]) : [];
    const list = Array.isArray(prev) ? prev : [];
    list.push(entry);
    while (list.length > CRASH_LOG_RING) {
      list.shift();
    }
    localStorage.setItem(CRASH_LOG_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // quota / private mode
  }
}

/**
 * Read recent crash records (newest last). Empty when none or unreadable.
 */
export function readCrashLog(): CrashLogEntry[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(CRASH_LOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as CrashLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Log a frontend error/boot event: console + localStorage + optional shell POST.
 * @param level error | warn | info
 * @param message Short human message (required for usefulness).
 * @param opts Optional stack / source; omitted fields are fine.
 */
export function reportCrash(
  level: "error" | "warn" | "info",
  message: string,
  opts?: { stack?: string; source?: string },
): void {
  const msg = (message || "(empty)").slice(0, 2000);
  const stack = opts?.stack?.slice(0, 8000);
  const source = opts?.source?.slice(0, 64);
  const entry: CrashLogEntry = {
    at: Date.now(),
    level,
    message: msg,
    stack,
    source,
  };

  const line = `[grok-desktop-crash] ${source ?? "?"} ${msg}${stack ? `\n${stack}` : ""}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }

  persistCrashLocally(entry);
  void postToShell(entry);
}

/**
 * POST the entry to the shell asset log endpoint (Wails same-origin).
 * Fire-and-forget; failures only console.warn once per call.
 */
async function postToShell(entry: CrashLogEntry): Promise<void> {
  const path = uiLogPath();
  if (!path || typeof fetch === "undefined") {
    return;
  }
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: entry.level,
        message: entry.message,
        stack: entry.stack,
        source: entry.source,
      }),
      // keepalive helps flush on unload; ignore failures.
      keepalive: true,
    });
  } catch (err) {
    console.warn("[grok-desktop-crash] ui log POST failed", err);
  }
}

/**
 * Install window.onerror + unhandledrejection handlers once.
 * Idempotent: second call is a no-op.
 */
let handlersInstalled = false;

export function installGlobalCrashHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") {
    return;
  }
  handlersInstalled = true;

  window.addEventListener("error", (ev) => {
    const msg =
      ev.message ||
      (ev.error instanceof Error ? ev.error.message : "window error");
    const stack =
      ev.error instanceof Error
        ? ev.error.stack
        : `${ev.filename}:${ev.lineno}:${ev.colno}`;
    reportCrash("error", msg, { stack, source: "window.onerror" });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandledrejection";
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportCrash("error", msg, { stack, source: "unhandledrejection" });
  });

  reportCrash("info", "ui boot", { source: "boot" });
}
