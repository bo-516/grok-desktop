/**
 * Environment variable whitelist for grok child processes (F-CFG-05 / TC-OPS-06).
 * Avoid leaking unrelated secrets into agent children; always pass XAI_API_KEY when set.
 */

/** Always-allowed keys (product-required + standard runtime). */
export const ALWAYS_PASS_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SHELL",
  "XAI_API_KEY",
  "GROK_BIN",
  "GROK_HOME",
  "GROK_SANDBOX",
  "GROK_WEB_FETCH",
  "GROK_MEMORY",
  "GROK_SUBAGENTS",
  "GROK_LSP_TOOLS",
  "GROK_TOOL_SEARCH",
  "GROK_LOG_FILE",
  "RUST_LOG",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

/**
 * Filter process.env (or a provided bag) down to the whitelist + optional extras.
 * @param source Full environment.
 * @param extraAllow Additional keys the session opted into (SPAWN config).
 * @returns Sanitized env object for spawn.
 */
export function filterEnvForGrokChild(
  source: NodeJS.ProcessEnv,
  extraAllow: string[] = [],
): NodeJS.ProcessEnv {
  const allow = new Set<string>([
    ...ALWAYS_PASS_ENV,
    ...extraAllow.filter((k) => typeof k === "string" && k.trim()),
  ]);
  // Also pass any GROK_* / XAI_* already present
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (
      allow.has(key) ||
      key.startsWith("GROK_") ||
      key.startsWith("XAI_")
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Assert that a secret key is not present in a loggable snapshot.
 * @param logText Combined logs.
 * @param secretValue Actual secret; empty skips.
 */
export function logDoesNotContainSecret(
  logText: string,
  secretValue: string | undefined | null,
): boolean {
  if (!secretValue || secretValue.length < 4) {
    return true;
  }
  return !logText.includes(secretValue);
}
