/**
 * Read one grok-build session's on-disk transcript without spawning the agent.
 * Cold desktop opens paint from this so the user is not blocked on session/load.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  decodeWorkspaceDirName,
  resolveGrokHome,
} from "./sessionDiskList.js";

/**
 * Ceiling on a single history file. Larger files fall through to session/load
 * rather than stalling the CLI channel with a multi-tens-of-MB parse.
 */
export const SESSION_HISTORY_MAX_BYTES = 32 * 1024 * 1024;

/** One ACP update extracted from updates.jsonl (replay_end wire shape). */
export type DiskHistoryUpdate = {
  /** Raw `params.update` / sessionUpdate object. */
  update: Record<string, unknown>;
  /** Wire eventId when present (dedupe on the desktop reduce). */
  eventId?: string;
};

/**
 * Disk transcript for one session. Prefer `chatHistory` (complete turns);
 * `updates` is the ACP log and is often missing older user echoes.
 */
export type DiskSessionHistory = {
  /** Requested ACP session id. */
  sessionId: string;
  /** Workspace cwd from the sessions folder, when known. */
  cwd: string;
  /** Parsed `chat_history.jsonl` objects (may be empty). */
  chatHistory: unknown[];
  /** Parsed `updates.jsonl` session/update items (may be empty). */
  updates: DiskHistoryUpdate[];
  /** chatHistory.length + updates.length (for logs / tests). */
  count: number;
  /** Bytes actually read from disk. */
  bytes: number;
};

/**
 * Percent-encode a workspace path the way grok-build names session folders.
 * @param workspace Absolute cwd (e.g. `/Users/me/proj`).
 * @returns Folder name under `~/.grok/sessions`.
 */
export function encodeWorkspaceDirName(workspace: string): string {
  return encodeURIComponent(workspace);
}

/**
 * QueryEscape-style encoding (Go fixtures / some writers use `+` for spaces).
 * @param workspace Absolute cwd.
 * @returns Alternate folder name to try when Path/URI encoding misses.
 */
export function encodeWorkspaceDirNameQuery(workspace: string): string {
  return encodeURIComponent(workspace).replace(/%20/g, "+");
}

/**
 * Locate `~/.grok/sessions/<ws>/<sessionId>` for one id.
 * Tries cwd-encoded paths first, then walks every workspace folder.
 * @param sessionId ACP session folder name.
 * @param cwd Optional workspace hint from the catalog row.
 * @param grokHome Override home (tests).
 * @returns Absolute session directory, or null when the folder is missing.
 */
export async function findSessionDir(opts: {
  sessionId: string;
  cwd?: string;
  grokHome?: string;
}): Promise<string | null> {
  const sessionId = opts.sessionId.trim();
  if (!sessionId || sessionId.startsWith(".")) {
    return null;
  }
  const sessionsRoot = path.join(opts.grokHome ?? resolveGrokHome(), "sessions");
  const cwd = opts.cwd?.trim() ?? "";
  if (cwd) {
    for (const enc of [
      encodeWorkspaceDirName(cwd),
      encodeWorkspaceDirNameQuery(cwd),
    ]) {
      const candidate = path.join(sessionsRoot, enc, sessionId);
      if (await isDirectory(candidate)) {
        return candidate;
      }
    }
  }
  let workspaceDirs: string[] = [];
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    workspaceDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const encoded of workspaceDirs) {
    const candidate = path.join(sessionsRoot, encoded, sessionId);
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Read chat_history.jsonl (preferred) and/or updates.jsonl for a session.
 * Missing files yield empty arrays — not an error. Oversized files are skipped
 * so a huge transcript cannot block the CLI socket.
 * @param opts sessionId required; cwd speeds up the folder lookup.
 * @returns History payload the desktop reduces into SessionState.
 */
export async function readSessionHistoryFromDisk(opts: {
  sessionId: string;
  cwd?: string;
  grokHome?: string;
  maxBytes?: number;
}): Promise<DiskSessionHistory> {
  const sessionId = opts.sessionId.trim();
  const empty: DiskSessionHistory = {
    sessionId,
    cwd: opts.cwd?.trim() ?? "",
    chatHistory: [],
    updates: [],
    count: 0,
    bytes: 0,
  };
  if (!sessionId) {
    return empty;
  }
  const sessionDir = await findSessionDir(opts);
  if (!sessionDir) {
    return empty;
  }
  const cwd =
    decodeWorkspaceDirName(path.basename(path.dirname(sessionDir))) ||
    opts.cwd?.trim() ||
    "";
  const maxBytes = opts.maxBytes ?? SESSION_HISTORY_MAX_BYTES;
  const chatPath = path.join(sessionDir, "chat_history.jsonl");
  const updatesPath = path.join(sessionDir, "updates.jsonl");
  const chatRead = await readJsonlFile(chatPath, maxBytes);
  const updatesRead = chatRead.records.length
    ? { records: [] as unknown[], bytes: 0 }
    : await readJsonlFile(updatesPath, maxBytes);
  const chatHistory = chatRead.records;
  const updates = updatesRead.records
    .map(parseHistoryLine)
    .filter((item): item is DiskHistoryUpdate => Boolean(item));
  return {
    sessionId,
    cwd,
    chatHistory,
    updates,
    count: chatHistory.length + updates.length,
    bytes: chatRead.bytes + updatesRead.bytes,
  };
}

/**
 * Pull an ACP update out of one updates.jsonl object.
 * Accepts `session/update`, `_x.ai/session/update`, or a bare `{sessionUpdate}`.
 * @param raw Parsed JSONL object.
 * @returns Wire item, or null when the line is not a session update.
 */
export function parseHistoryLine(raw: unknown): DiskHistoryUpdate | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const params =
    rec.params && typeof rec.params === "object"
      ? (rec.params as Record<string, unknown>)
      : rec;
  let update: Record<string, unknown> | null = null;
  let meta: Record<string, unknown> | undefined;
  if (params.update && typeof params.update === "object") {
    update = params.update as Record<string, unknown>;
  } else if (rec.sessionUpdate) {
    update = rec;
  }
  if (!update || typeof update.sessionUpdate !== "string") {
    return null;
  }
  if (params._meta && typeof params._meta === "object") {
    meta = params._meta as Record<string, unknown>;
  } else if (rec._meta && typeof rec._meta === "object") {
    meta = rec._meta as Record<string, unknown>;
  }
  const eventId =
    typeof meta?.eventId === "string" && meta.eventId.trim()
      ? meta.eventId.trim()
      : undefined;
  return eventId ? { update, eventId } : { update };
}

/**
 * Read a JSONL file up to maxBytes of complete lines.
 * @param filePath Absolute path.
 * @param maxBytes Byte ceiling; files larger than this are skipped entirely.
 * @returns Parsed objects and bytes read (0 when missing / oversized).
 */
async function readJsonlFile(
  filePath: string,
  maxBytes: number,
): Promise<{ records: unknown[]; bytes: number }> {
  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return { records: [], bytes: 0 };
  }
  if (size <= 0) {
    return { records: [], bytes: 0 };
  }
  if (size > maxBytes) {
    return { records: [], bytes: 0 };
  }
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { records: [], bytes: 0 };
  }
  const records: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Skip a corrupt line; the rest of the transcript is still useful.
    }
  }
  return { records, bytes: size };
}

/**
 * True when path exists and is a directory.
 * @param dir Absolute path to test.
 */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
