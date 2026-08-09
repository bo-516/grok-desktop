/**
 * Path helpers for structural tests that assert on source text.
 *
 * Purpose: tests live under `test/` while the code they inspect lives under
 * `src/`; centralizing the base paths keeps the relative depth in one file.
 * Boundary: read-only; callers must pass paths relative to the documented root.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of apps/desktop (two levels up from test/helpers/). */
export const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Absolute path of apps/desktop/src. */
export const SRC_ROOT = path.join(DESKTOP_ROOT, "src");

/**
 * Reads a source file as UTF-8 text.
 * @param rel Path relative to `src/`, e.g. "widgets/TimelineView.tsx".
 * @returns File contents; throws if the file was moved or deleted — that is the
 *          intended signal for a structural test, not a case to swallow.
 */
export function readSrc(rel: string): string {
  return readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

/**
 * Reads a file from the desktop app root (vite/uno configs, index.html).
 * Also used for sibling paths under `apps/` via `../bridge/...`.
 * @param rel Path relative to `apps/desktop/`, e.g. "uno.shortcuts.ts".
 */
export function readDesktopRoot(rel: string): string {
  return readFileSync(path.join(DESKTOP_ROOT, rel), "utf8");
}

/**
 * Existence probe for "this file must NOT exist" assertions.
 * @param rel Path relative to `src/`.
 * @returns true when present; used by negative assertions on deleted css files.
 */
export function srcExists(rel: string): boolean {
  return existsSync(path.join(SRC_ROOT, rel));
}
