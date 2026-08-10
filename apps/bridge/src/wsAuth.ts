/**
 * WebSocket local auth for the desktop bridge.
 * Requires a per-start token and rejects unexpected browser Origins so a
 * random webpage cannot drive the agent on 127.0.0.1.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Result of validating an inbound WS upgrade / connection. */
export type WsAuthResult =
  | { ok: true }
  | { ok: false; reason: string; status: number };

/** Injectable auth configuration for Node and (by contract) Go bridges. */
export type WsAuthConfig = {
  /** Shared secret required on every connection (query `token` or header). */
  token: string;
  /**
   * Allowed Origin header values for browser clients.
   * Empty means reject any non-empty Origin (local tools without Origin still pass with token).
   */
  allowedOrigins: string[];
};

/**
 * Resolve listen port from env or explicit value.
 * @param raw BRIDGE_PORT / CLI value; empty or invalid → defaultPort.
 * @param defaultPort Fallback when unset (dev default 8765).
 * @returns Integer port in 0..65535; 0 means OS-assigned ephemeral.
 */
export function resolveListenPort(
  raw: string | undefined,
  defaultPort = 8765,
): number {
  if (raw === undefined || raw === "") {
    return defaultPort;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    return defaultPort;
  }
  return n;
}

/**
 * Resolve bridge auth token: env wins; otherwise generate a random secret.
 * @param envToken BRIDGE_TOKEN when set by shell or operator.
 * @returns Non-empty token string.
 */
export function resolveBridgeToken(envToken: string | undefined): string {
  const trimmed = envToken?.trim();
  if (trimmed) {
    return trimmed;
  }
  return randomBytes(24).toString("base64url");
}

/**
 * Parse comma-separated Origin allow-list.
 * @param raw BRIDGE_ALLOWED_ORIGINS (e.g. "http://localhost:5173,null").
 * @returns Deduped list; default includes Vite dev + null/file for packaged shells.
 */
export function resolveAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "null",
      "file://",
    ];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const o = part.trim();
    if (!o || seen.has(o)) {
      continue;
    }
    seen.add(o);
    out.push(o);
  }
  return out;
}

/**
 * Extract token from request URL query or Authorization / X-Bridge-Token header.
 * @param req HTTP upgrade request.
 * @returns Token string or null when absent.
 */
export function extractTokenFromRequest(req: IncomingMessage): string | null {
  const host = req.headers.host ?? "127.0.0.1";
  try {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const q = url.searchParams.get("token");
    if (q) {
      return q;
    }
  } catch {
    /* fall through to headers */
  }
  const headerToken = req.headers["x-bridge-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) {
      return m[1].trim();
    }
  }
  return null;
}

/**
 * Whether Origin is allowed for this bridge instance.
 * Missing Origin (non-browser clients: Node ws, curl) is accepted when token is valid.
 * @param origin Header value or undefined.
 * @param allowed Allow-list from resolveAllowedOrigins.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
): boolean {
  if (origin === undefined || origin === "") {
    return true;
  }
  if (allowed.includes(origin)) {
    return true;
  }
  // file:// origins may include a path suffix depending on the engine.
  if (origin.startsWith("file:") && allowed.includes("file://")) {
    return true;
  }
  return false;
}

/**
 * Validate token + Origin for an inbound WebSocket upgrade.
 * @param req Upgrade request.
 * @param config Auth config for this process.
 * @returns ok or reject reason with suggested HTTP status.
 */
export function authorizeWsConnection(
  req: IncomingMessage,
  config: WsAuthConfig,
): WsAuthResult {
  const originHeader = req.headers.origin;
  const origin =
    typeof originHeader === "string" ? originHeader : undefined;
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return {
      ok: false,
      reason: `origin not allowed: ${origin ?? "(missing)"}`,
      status: 403,
    };
  }
  const token = extractTokenFromRequest(req);
  if (!token) {
    return { ok: false, reason: "missing bridge token", status: 401 };
  }
  if (token !== config.token) {
    return { ok: false, reason: "invalid bridge token", status: 401 };
  }
  return { ok: true };
}

/**
 * Build the public WS URL clients should use (token in query for browser WebSocket).
 * @param port Listen port.
 * @param token Auth token.
 * @param host Bind host (default loopback).
 */
export function bridgeWsUrl(
  port: number,
  token: string,
  host = "127.0.0.1",
): string {
  return `ws://${host}:${port}?token=${encodeURIComponent(token)}`;
}
