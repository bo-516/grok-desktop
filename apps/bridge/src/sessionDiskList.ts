/**
 * Enumerate upstream sessions under `~/.grok/sessions` (all workspaces).
 * Used by the bridge CLI channel so the desktop catalog can show every
 * workspace folder, not only the cwd of the currently open session.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** One session row for desktop catalog merge (id + workspace + title + times). */
export type DiskSessionRow = {
  /** Upstream session id (uuid). */
  id: string;
  /** Absolute workspace cwd from summary or parent folder decode. */
  cwd: string;
  /** Display title from summary (generated_title / session_summary). */
  title: string;
  /** ISO updated time when known. */
  updatedAt?: string;
  /** ISO created time when known. */
  createdAt?: string;
};

/**
 * Resolve the grok home directory (`GROK_HOME` or `~/.grok`).
 * @returns Absolute path to the grok home folder.
 */
export function resolveGrokHome(): string {
  const fromEnv = process.env.GROK_HOME?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".grok");
}

/**
 * Decode a percent-encoded workspace folder name under `sessions/`.
 * @param encodedDirName Directory basename (e.g. `%2FUsers%2F…`).
 * @returns Absolute path, or empty when decoding fails.
 */
export function decodeWorkspaceDirName(encodedDirName: string): string {
  try {
    return decodeURIComponent(encodedDirName);
  } catch {
    return "";
  }
}

/**
 * Read one session's summary.json into a catalog-friendly row.
 * Missing / corrupt summary still yields a row when the session dir exists.
 * @param sessionDir Absolute path to `…/sessions/<ws>/<id>`.
 * @param sessionId Session folder name (uuid).
 * @param fallbackCwd Workspace path from the parent folder decode.
 * @returns Disk session row, or null when the folder is not a session.
 */
export async function readDiskSessionRow(
  sessionDir: string,
  sessionId: string,
  fallbackCwd: string,
): Promise<DiskSessionRow | null> {
  if (!sessionId || sessionId.startsWith(".")) {
    return null;
  }
  let title = "";
  let cwd = fallbackCwd;
  let updatedAt: string | undefined;
  let createdAt: string | undefined;
  try {
    const raw = await readFile(path.join(sessionDir, "summary.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const info =
      parsed.info && typeof parsed.info === "object"
        ? (parsed.info as Record<string, unknown>)
        : undefined;
    const infoCwd =
      typeof info?.cwd === "string" && info.cwd.trim() ? info.cwd.trim() : "";
    if (infoCwd) {
      cwd = infoCwd;
    }
    const generated =
      typeof parsed.generated_title === "string"
        ? parsed.generated_title.trim()
        : "";
    const summary =
      typeof parsed.session_summary === "string"
        ? parsed.session_summary.trim()
        : "";
    title = generated || summary;
    if (typeof parsed.updated_at === "string" && parsed.updated_at) {
      updatedAt = parsed.updated_at;
    } else if (
      typeof parsed.last_active_at === "string" &&
      parsed.last_active_at
    ) {
      updatedAt = parsed.last_active_at;
    }
    if (typeof parsed.created_at === "string" && parsed.created_at) {
      createdAt = parsed.created_at;
    }
  } catch {
    // summary optional — still list the folder when mtime is available
  }
  if (!updatedAt) {
    try {
      const st = await stat(sessionDir);
      updatedAt = st.mtime.toISOString();
    } catch {
      return null;
    }
  }
  if (!title) {
    title = `Chat ${sessionId.slice(0, 8)}`;
  }
  return {
    id: sessionId,
    cwd: cwd || fallbackCwd,
    title,
    updatedAt,
    createdAt,
  };
}

/**
 * Walk `~/.grok/sessions/<encoded-cwd>/<sessionId>/` and collect rows for every
 * workspace. Optional `cwdFilter` keeps only one workspace (exact path match).
 * @param opts limit caps the newest rows; cwdFilter scopes to one workspace.
 * @returns Sessions sorted by updatedAt desc (newest first).
 */
export async function listSessionsFromDisk(opts: {
  /** Max rows to return (default 500). */
  limit?: number;
  /** When set, only include sessions under this absolute workspace path. */
  cwdFilter?: string;
  /** Override grok home (tests). */
  grokHome?: string;
}): Promise<DiskSessionRow[]> {
  const limit =
    typeof opts.limit === "number" && opts.limit > 0
      ? Math.min(Math.floor(opts.limit), 2000)
      : 500;
  const sessionsRoot = path.join(opts.grokHome ?? resolveGrokHome(), "sessions");
  let workspaceDirs: string[] = [];
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    workspaceDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const filterCwd = opts.cwdFilter?.replace(/[/\\]+$/, "") ?? "";
  const rows: DiskSessionRow[] = [];

  for (const encoded of workspaceDirs) {
    const workspace = decodeWorkspaceDirName(encoded);
    if (!workspace) {
      continue;
    }
    if (filterCwd && workspace.replace(/[/\\]+$/, "") !== filterCwd) {
      continue;
    }
    const wsDir = path.join(sessionsRoot, encoded);
    let sessionNames: string[] = [];
    try {
      const entries = await readdir(wsDir, { withFileTypes: true });
      sessionNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const sessionId of sessionNames) {
      const row = await readDiskSessionRow(
        path.join(wsDir, sessionId),
        sessionId,
        workspace,
      );
      if (row) {
        rows.push(row);
      }
    }
  }

  rows.sort((a, b) => {
    const aT = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bT = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    const aOk = Number.isNaN(aT) ? 0 : aT;
    const bOk = Number.isNaN(bT) ? 0 : bT;
    return bOk - aOk;
  });
  return rows.slice(0, limit);
}
