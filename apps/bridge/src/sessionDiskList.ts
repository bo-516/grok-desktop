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
  /**
   * Upstream role from `summary.json.session_kind`; absent for ordinary chats.
   * Known values: `subagent`, `subagent_resume`, `subagent_fork`.
   */
  sessionKind?: string;
  /** Parent chat id when this row is a harness-spawned subagent session. */
  parentSessionId?: string;
};

/**
 * Whether a session_kind marks a harness-spawned subagent chat.
 *
 * Upstream emits three variants today (`subagent`, `subagent_resume`,
 * `subagent_fork`), so an equality check would leak the other two into the
 * rail. Unknown / absent kinds are deliberately treated as user chats:
 * showing one row too many is recoverable, hiding a real conversation is not.
 * @param kind Raw session_kind value, possibly undefined.
 * @returns True when the row should be hidden from the session rail.
 */
export function isSubagentSessionKind(kind: string | undefined): boolean {
  return typeof kind === "string" && kind.startsWith("subagent");
}

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
 * Build a child→parent index from `<session>/subagents/<childId>/meta.json`.
 *
 * The child session's own summary.json has no parent pointer, so this is the
 * only on-disk source for the relation. Directory names have matched
 * child_session_id in every recorded case, but that is an observed invariant,
 * not a documented contract — read the field instead of trusting the name.
 * Unreadable entries are skipped: a missing parent link only costs a drill-down
 * breadcrumb, while throwing here would empty the whole session rail.
 * @param sessionDir Absolute path to one `…/sessions/<ws>/<id>` folder.
 * @param parentId This session's id (the parent).
 * @returns Map of child session id → this session's id; empty when no subagents.
 */
async function readSubagentChildIndex(
  sessionDir: string,
  parentId: string,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let names: string[] = [];
  try {
    const entries = await readdir(path.join(sessionDir, "subagents"), {
      withFileTypes: true,
    });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return index;
  }
  for (const name of names) {
    try {
      const raw = await readFile(
        path.join(sessionDir, "subagents", name, "meta.json"),
        "utf8",
      );
      const meta = JSON.parse(raw) as Record<string, unknown>;
      const childId =
        typeof meta.child_session_id === "string" && meta.child_session_id.trim()
          ? meta.child_session_id.trim()
          : name;
      index.set(childId, parentId);
    } catch {
      // Corrupt meta still links by directory name so drill-down can resolve.
      index.set(name, parentId);
    }
  }
  return index;
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
  let sessionKind: string | undefined;
  let parentSessionId: string | undefined;
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
    const kindRaw =
      typeof parsed.session_kind === "string" ? parsed.session_kind.trim() : "";
    if (kindRaw) {
      sessionKind = kindRaw;
    }
    // Peer forks store parent_session_id on summary (not only under subagents/).
    const parentRaw =
      typeof parsed.parent_session_id === "string"
        ? parsed.parent_session_id.trim()
        : typeof parsed.parentSessionId === "string"
          ? parsed.parentSessionId.trim()
          : "";
    if (parentRaw) {
      parentSessionId = parentRaw;
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
    sessionKind,
    parentSessionId,
  };
}

/**
 * Walk `~/.grok/sessions/<encoded-cwd>/<sessionId>/` and collect rows for every
 * workspace. Optional `cwdFilter` keeps only one workspace (exact path match).
 * Subagent rows stay in the list (filter at rail render, not data layer).
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
  /** child session id → parent session id across all workspaces in this walk. */
  const parentByChild = new Map<string, string>();

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
      const sessionDir = path.join(wsDir, sessionId);
      const row = await readDiskSessionRow(sessionDir, sessionId, workspace);
      if (row) {
        rows.push(row);
      }
      const childIndex = await readSubagentChildIndex(sessionDir, sessionId);
      for (const [childId, parentId] of childIndex) {
        parentByChild.set(childId, parentId);
      }
    }
  }

  for (const row of rows) {
    // Subagent meta index fills parent when summary omitted it.
    const parentId = parentByChild.get(row.id);
    if (parentId && !row.parentSessionId) {
      row.parentSessionId = parentId;
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
