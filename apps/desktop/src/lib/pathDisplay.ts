/**
 * Pure path presentation helpers for timeline / preview surfaces.
 *
 * Display only: every helper keeps the untouched absolute path reachable so
 * copy-to-clipboard, `data-path` attributes and bridge file reads still work on
 * the real path. Shortening is best-effort — when the workspace root is unknown
 * the absolute path is returned unchanged rather than guessed at.
 */

/** `file://` scheme prefix stripped before any path comparison. */
const FILE_URI_PREFIX = "file://";

/**
 * Absolute path token inside free-form text (tool titles).
 * Group 1 is the leading boundary (kept as-is) so `https://x/y` cannot match:
 * its `//` follows `:`, which is not a boundary character. Group 2 must have at
 * least one character after the separator, so a bare `/` argument is left alone.
 */
const ABS_PATH_TOKEN = /(^|[\s`'"([<])((?:[A-Za-z]:)?[\\/][^\s`'"()[\]<>]+)/g;

/** One-line path label split so the file name is never the part that gets cut. */
export type PathDisplay = {
  /** Original absolute path (file URI decoded) — what Copy must put on the clipboard. */
  full: string;
  /** Directory part of the display label, without trailing slash ("" for a bare file name). */
  dir: string;
  /** Last segment (file name); rendered at full length by PathLabelView. */
  base: string;
  /** `dir/base` — the complete shortened one-line label. */
  label: string;
  /** True when `full` lives under the workspace root, i.e. the label is workspace-relative. */
  inWorkspace: boolean;
};

/**
 * Strip a `file://` prefix and percent-encoding from a location string.
 * @param raw Location from ACP: `/abs/path`, `file:///abs/path`, or free text.
 * @returns Plain filesystem path; non-URI input is returned unchanged, and a
 *   malformed escape sequence falls back to the still-encoded remainder rather
 *   than throwing into the render pass.
 */
export function stripFileUri(raw: string): string {
  if (!raw.startsWith(FILE_URI_PREFIX)) {
    return raw;
  }
  const withoutScheme = raw.slice(FILE_URI_PREFIX.length) || "/";
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/**
 * Normalize separators so Windows paths compare and render POSIX-style.
 * @param path Any path string.
 * @returns Same path with `\` turned into `/`.
 */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Drop trailing separators so `/a/b/` and `/a/b` compare equal.
 * @param path POSIX-normalized path.
 * @returns Path without trailing slashes; the filesystem root stays `/`.
 */
function trimTrailingSep(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed && path.startsWith("/")) {
    return "/";
  }
  return trimmed;
}

/**
 * Guess the user home directory from an absolute workspace path.
 * The renderer runs in a browser context with no `process.env.HOME`, so the
 * user folder is inferred from the workspace root instead. An empty workspace —
 * or one outside a user folder — yields "", and callers then keep paths
 * absolute; that is deliberate, a wrong `~` would hide a real location.
 * @param workspace Session workspace root (may be empty).
 * @returns Home prefix without trailing slash, or "" when it cannot be inferred.
 */
export function homePrefixFrom(workspace: string): string {
  const ws = toPosix(workspace.trim());
  const posix = /^(\/(?:Users|home)\/[^/]+)(?:\/|$)/.exec(ws);
  if (posix) {
    return posix[1] ?? "";
  }
  const win = /^([A-Za-z]:\/Users\/[^/]+)(?:\/|$)/.exec(ws);
  return win?.[1] ?? "";
}

/**
 * Shorten one absolute path: workspace-relative first, then `~`, then absolute.
 * @param raw Path or file URI to display.
 * @param workspace Session workspace root; empty disables both shortenings.
 * @returns Display text plus whether it resolved inside the workspace. A path
 *   equal to the workspace root renders as its own folder name, never "".
 */
export function relativizePath(
  raw: string,
  workspace: string,
): { text: string; inWorkspace: boolean } {
  const path = trimTrailingSep(toPosix(stripFileUri(raw).trim()));
  const ws = trimTrailingSep(toPosix(workspace.trim()));
  const home = homePrefixFrom(workspace);
  if (ws && path === ws) {
    const segments = ws.split("/").filter(Boolean);
    return { text: segments[segments.length - 1] ?? ws, inWorkspace: true };
  }
  if (ws && path.startsWith(`${ws}/`)) {
    return { text: path.slice(ws.length + 1), inWorkspace: true };
  }
  if (home && path.startsWith(`${home}/`)) {
    return { text: `~${path.slice(home.length)}`, inWorkspace: false };
  }
  return { text: path, inWorkspace: false };
}

/**
 * Build the display parts for one path.
 * @param raw Path or file URI from a tool location / diff fragment.
 * @param workspace Session workspace root; empty keeps the path absolute.
 * @returns Split label whose `full` field stays copy/read-safe.
 */
export function toPathDisplay(raw: string, workspace: string): PathDisplay {
  const full = stripFileUri(raw).trim();
  const relative = relativizePath(raw, workspace);
  const segments = relative.text.split("/");
  const base = segments[segments.length - 1] ?? relative.text;
  return {
    full,
    dir: segments.slice(0, -1).join("/"),
    base,
    label: relative.text,
    inWorkspace: relative.inWorkspace,
  };
}

/**
 * Collapse middle segments until a label fits, keeping the first segment and
 * the file name intact (`~/…/src/server/prompt.js`).
 * @param label Already-relativized label.
 * @param maxLen Soft budget in characters; a label with fewer than three
 *   segments is returned untouched even when it overflows, since there is
 *   nothing safe left to drop.
 * @returns Compacted label.
 */
export function compactPathLabel(label: string, maxLen = 44): string {
  const isAbsolute = label.startsWith("/");
  const parts = label.split("/").filter(Boolean);
  if (label.length <= maxLen || parts.length <= 2) {
    return label;
  }
  const head = isAbsolute ? `/${parts[0]}` : (parts[0] ?? "");
  const tail = [parts[parts.length - 1] ?? ""];
  for (let i = parts.length - 2; i > 0; i -= 1) {
    const candidate = [head, "…", parts[i], ...tail].join("/");
    if (candidate.length > maxLen) {
      break;
    }
    tail.unshift(parts[i] ?? "");
  }
  return [head, "…", ...tail].join("/");
}

/** A tool title cut around its first absolute path token. */
export type TitlePathSplit = {
  /** Text before the path (``Edit ` ``); rendered as-is. */
  before: string;
  /** Raw absolute path token — feed to `toPathDisplay` for the label. */
  path: string;
  /** Text after the path (a closing backtick / bracket). */
  after: string;
};

/**
 * Split a tool title around its first absolute path token so the head can
 * render the path as a dir + file-name pair (only the dir may be ellipsized).
 * @param title Raw ACP tool title.
 * @returns Split parts, or null when the title carries no path — callers then
 *   fall back to plain truncated text.
 */
export function splitTitlePath(title: string): TitlePathSplit | null {
  if (!title) {
    return null;
  }
  // Local copy: the shared token regex is /g and exec() would carry lastIndex.
  const match = new RegExp(ABS_PATH_TOKEN.source).exec(title);
  const path = match?.[2];
  if (!match || !path) {
    return null;
  }
  const start = (match.index ?? 0) + (match[1]?.length ?? 0);
  return {
    before: title.slice(0, start),
    path,
    after: title.slice(start + path.length),
  };
}

/**
 * Rewrite absolute paths embedded in a tool title for display.
 * Used for heads like ``Edit `/Users/me/proj/src/a.ts` `` → ``Edit `src/a.ts` ``.
 * @param title Raw ACP tool title; non-path text passes through untouched.
 * @param workspace Session workspace root; empty leaves the title as-is.
 * @param maxLen Soft budget per path token before middle segments collapse.
 * @returns Title with each absolute path token replaced by its short label.
 */
export function relativizeTitlePaths(
  title: string,
  workspace: string,
  maxLen = 44,
): string {
  if (!title) {
    return title;
  }
  return title.replace(ABS_PATH_TOKEN, (_match, lead: string, token: string) => {
    const short = compactPathLabel(relativizePath(token, workspace).text, maxLen);
    return `${lead}${short}`;
  });
}
