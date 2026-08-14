/**
 * Probe local grok CLI and login state for UI banners and pre-handshake checks.
 * Does not read API key contents; only whether usable credentials exist.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolveGrokBin } from "./spawnGrok.js";
import type { EnvironmentInfo } from "./protocol.js";
import { isGrokVersionSupported } from "./versionCheck.js";

/** Default pool capacity (one process per session); override with BRIDGE_POOL_CAPACITY. */
export function poolCapacityFromEnv(): number {
  const raw = Number(process.env.BRIDGE_POOL_CAPACITY ?? 8);
  if (!Number.isFinite(raw) || raw < 1) {
    return 8;
  }
  return Math.min(Math.floor(raw), 16);
}

/**
 * Resolve the ~/.grok/auth.json path (or the Windows user-profile equivalent).
 * @returns Absolute path; if HOME is missing, still returns a path based on an empty string for display.
 */
export function defaultAuthJsonPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".grok", "auth.json");
}

/**
 * Probe auth source: process env XAI_API_KEY first, then local cached_token file.
 * @returns authSource and whether logged in.
 */
export function probeAuthSource(): {
  authed: boolean;
  authSource: EnvironmentInfo["authSource"];
  authPathChecked: string;
} {
  const authPathChecked = defaultAuthJsonPath();
  if (process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim()) {
    return { authed: true, authSource: "xai_api_key", authPathChecked };
  }
  if (existsSync(authPathChecked)) {
    return { authed: true, authSource: "cached_token", authPathChecked };
  }
  return { authed: false, authSource: "none", authPathChecked };
}

/**
 * Run `grok --version`; return null on timeout or failure (soft fail; does not block structural probing).
 * @param bin grok executable path or PATH name.
 * @param timeoutMs Max wait in milliseconds.
 */
export function readGrokVersion(
  bin: string,
  timeoutMs = 3000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(out.trim() || null);
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean);
      resolve(line ?? null);
    });
  });
}

/**
 * Aggregate environment probe results.
 * @param poolCapacity Current bridge pool capacity, returned to the UI as well.
 * @returns EnvironmentInfo; ok means CLI found and logged in.
 */
export async function checkEnvironment(
  poolCapacity: number = poolCapacityFromEnv(),
): Promise<EnvironmentInfo> {
  const auth = probeAuthSource();
  let grokPath: string | null = null;
  let version: string | null = null;
  let message = "";

  try {
    grokPath = resolveGrokBin();
  } catch (e) {
    message =
      e instanceof Error
        ? e.message
        : "grok binary not found (set GROK_BIN or install CLI)";
    return {
      grokPath: null,
      version: null,
      authed: auth.authed,
      authSource: auth.authSource,
      authPathChecked: auth.authPathChecked,
      ok: false,
      message,
      poolCapacity,
    };
  }

  version = await readGrokVersion(grokPath);

  const versionCheck = isGrokVersionSupported(version);
  if (!versionCheck.ok) {
    return {
      grokPath,
      version,
      authed: auth.authed,
      authSource: auth.authSource,
      authPathChecked: auth.authPathChecked,
      ok: false,
      message: versionCheck.message,
      poolCapacity,
    };
  }

  if (!auth.authed) {
    message =
      "No grok login detected: run `grok login` or set the XAI_API_KEY environment variable";
    return {
      grokPath,
      version,
      authed: false,
      authSource: "none",
      authPathChecked: auth.authPathChecked,
      ok: false,
      message,
      poolCapacity,
    };
  }

  message = version
    ? `grok ready · ${version} · auth=${auth.authSource}`
    : `grok ready · auth=${auth.authSource}`;

  return {
    grokPath,
    version,
    authed: true,
    authSource: auth.authSource,
    authPathChecked: auth.authPathChecked,
    ok: true,
    message,
    poolCapacity,
  };
}
