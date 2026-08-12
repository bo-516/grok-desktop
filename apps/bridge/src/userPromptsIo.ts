/**
 * Low-level managed-file I/O: atomic write, ownership gate, path display.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { MANAGED_MARKER } from "./userPromptsFormat.js";

/**
 * Atomic write: same-dir tmp → fsync → rename; mode 0600; dirs 0700.
 * @param filePath Target absolute path.
 * @param body String or Buffer content.
 */
export function atomicWrite(filePath: string, body: string | Buffer): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // chmod may fail on some FS; ignore.
  }
  // Also ensure parent `.grok` if we created nested rules.
  const parent = path.dirname(dir);
  if (path.basename(dir) === "rules" && path.basename(parent) === ".grok") {
    try {
      chmodSync(parent, 0o700);
    } catch {
      // ignore
    }
  }

  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  try {
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, buf);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // ignore
    }
    renameSync(tmp, filePath);
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // ignore
    }
  } catch (err) {
    try {
      if (existsSync(tmp)) {
        unlinkSync(tmp);
      }
    } catch {
      // ignore cleanup
    }
    throw new Error(
      `failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Refuse set/clear when a non-managed file already occupies the path.
 * @param filePath Target path.
 */
export function assertManagedOrAbsent(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  let first = "";
  try {
    const content = readFileSync(filePath, "utf8");
    first = (content.split(/\r?\n/)[0] ?? "").trim();
  } catch (err) {
    throw new Error(
      `failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (first !== MANAGED_MARKER) {
    throw foreignError(filePath);
  }
}

/**
 * User-facing foreign-file error.
 * @param filePath Absolute path.
 */
export function foreignError(filePath: string): Error {
  return new Error(
    `\`${displayPath(filePath)}\` exists but was not written by grok-desktop — open it manually or rename it.`,
  );
}

/**
 * Shorten home prefix for error messages.
 * @param filePath Absolute path.
 */
export function displayPath(filePath: string): string {
  const home = homedir();
  if (home && filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}
