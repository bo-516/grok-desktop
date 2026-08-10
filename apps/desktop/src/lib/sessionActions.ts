/**
 * Session irreversible / fork / rewind action helpers (F-SESS-11/13, J-05).
 * Pure builders for command text + confirm prompts; bridge executes via prompt/cli.
 * Also normalizes upstream `sessions list` rows and merges them into the local catalog
 * without wiping rich timeline caches (F-SESS-07 / QA-SESS-37/38).
 */

import {
  fallbackSessionLabel,
  isWeakSessionTitle,
} from "@grok-desktop/acp-core";
import type { SessionRecord } from "@/store/sessionCatalog";
import { normalizeCatalog } from "@/store/sessionCatalog";
import {
  buildConfirmPrompt,
  type ConfirmPrompt,
} from "./confirmAction";

/** One row from `sessions_list` / disk enumeration after normalize. */
export type RemoteSessionRow = {
  id: string;
  title: string;
  workspace?: string;
  updatedAt?: string;
  createdAt?: string;
};

/**
 * Build slash command text for fork at a turn directive.
 * @param directive Optional fork directive / label.
 */
export function buildForkCommand(directive?: string): string {
  const d = directive?.trim();
  return d ? `/fork ${d}` : "/fork";
}

/**
 * Build slash command for rewind (destructive on disk).
 * @param target Optional turn marker.
 */
export function buildRewindCommand(target?: string): string {
  const t = target?.trim();
  return t ? `/rewind ${t}` : "/rewind";
}

/**
 * Confirm prompt for rewind with dirty-git awareness.
 * @param dirtyGit Whether workspace has uncommitted changes.
 */
export function rewindConfirm(dirtyGit: boolean): ConfirmPrompt {
  return buildConfirmPrompt("rewind", { dirtyGit });
}

/**
 * Confirm prompt for share upload to code.grok.com.
 */
export function shareConfirm(): ConfirmPrompt {
  return buildConfirmPrompt("share_upload", { uploadHost: "code.grok.com" });
}

/**
 * Normalize `sessions_list` payload (disk JSON or plain CLI text) into rows.
 * @param data Bridge result: `{ sessions }`, array, or `{ raw, lines }`.
 * @returns Catalog-friendly remote rows (may lack workspace for plain CLI).
 */
export function normalizeSessionsList(data: unknown): RemoteSessionRow[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data
      .map((row) => normalizeOneSession(row))
      .filter((r): r is RemoteSessionRow => Boolean(r));
  }
  if (typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const list = rec.sessions ?? rec.items ?? rec.data;
    if (Array.isArray(list)) {
      return list
        .map((row) => normalizeOneSession(row))
        .filter((r): r is RemoteSessionRow => Boolean(r));
    }
    if (typeof rec.raw === "string") {
      return parseSessionsListText(String(rec.raw));
    }
    if (Array.isArray(rec.lines)) {
      return parseSessionsListText(rec.lines.map(String).join("\n"));
    }
  }
  return [];
}

/**
 * Merge upstream session rows into the local catalog.
 * - Empty remote list leaves the catalog untouched (QA-SESS-38).
 * - Existing rich rows keep timeline / toolCalls; title only fills when weak.
 * - Workspace is filled when the local row is missing one.
 * - `updatedAt` takes the max of local and remote so rail order stays honest.
 * @param catalog Current local catalog.
 * @param rows Normalized remote sessions (all workspaces).
 * @param now Wall clock for brand-new rows missing timestamps.
 * @returns Normalized catalog with remote rows upserted.
 */
export function mergeRemoteSessionsIntoCatalog(
  catalog: SessionRecord[],
  rows: RemoteSessionRow[],
  now = Date.now(),
): SessionRecord[] {
  if (rows.length === 0) {
    return catalog;
  }
  const byId = new Map(catalog.map((rec) => [rec.id, rec]));
  for (const row of rows) {
    const existing = byId.get(row.id);
    const remoteUpdated = parseTimeMs(row.updatedAt);
    const remoteCreated = parseTimeMs(row.createdAt);
    if (existing) {
      const strongTitle = !isWeakSessionTitle(existing.title)
        ? existing.title
        : row.title?.trim() && !isWeakSessionTitle(row.title)
          ? row.title.trim()
          : existing.title;
      byId.set(row.id, {
        ...existing,
        workspace: existing.workspace || row.workspace || "",
        title: strongTitle,
        updatedAt: Math.max(existing.updatedAt, remoteUpdated ?? 0),
        createdAt: existing.createdAt || remoteCreated || existing.updatedAt,
      });
      continue;
    }
    const updatedAt = remoteUpdated ?? now;
    const title =
      row.title?.trim() && !isWeakSessionTitle(row.title.trim())
        ? row.title.trim()
        : fallbackSessionLabel(row.id);
    byId.set(row.id, {
      id: row.id,
      workspace: row.workspace || "",
      title,
      mode: "build",
      model: "",
      status: "idle",
      createdAt: remoteCreated ?? updatedAt,
      updatedAt,
      timeline: [],
      toolCalls: {},
      lastAgentText: "",
    });
  }
  return normalizeCatalog([...byId.values()]);
}

/**
 * Parse plain `grok sessions list` table / line output into remote rows.
 * @param text CLI stdout.
 */
function parseSessionsListText(text: string): RemoteSessionRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      );
      const id = m?.[1];
      if (!id) {
        return null;
      }
      // Prefer trailing SUMMARY column when the line is tabular.
      const afterId = line.slice(line.indexOf(id) + id.length).trim();
      const summaryMatch = afterId.match(
        /(?:local|remote|cloud)\s+(.+)$/i,
      );
      const rawTitle = (summaryMatch?.[1] ?? afterId).trim();
      return { id, title: rawTitle || id };
    })
    .filter((r): r is RemoteSessionRow => Boolean(r));
}

/**
 * Normalize one session-shaped object from disk or CLI JSON.
 * @param row Unknown list element.
 */
function normalizeOneSession(row: unknown): RemoteSessionRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, unknown>;
  const id = String(r.id ?? r.sessionId ?? r.session_id ?? "").trim();
  if (!id) {
    return null;
  }
  const title = String(r.title ?? r.name ?? id).trim() || id;
  const workspace = firstStringField(r, ["cwd", "workspace"]);
  const updatedAt = firstStringField(r, [
    "updatedAt",
    "updated_at",
    "last_active_at",
  ]);
  const createdAt = firstStringField(r, ["createdAt", "created_at"]);
  return { id, title, workspace, updatedAt, createdAt };
}

/**
 * Parse an ISO / epoch string into epoch ms, or undefined when unusable.
 * @param value Optional time from remote row.
 */
function parseTimeMs(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const asNum = Number(value);
  if (Number.isFinite(asNum) && asNum > 1e11) {
    return asNum;
  }
  // Unix seconds from search index
  if (Number.isFinite(asNum) && asNum > 1e9 && asNum < 1e11) {
    return Math.floor(asNum * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * First non-empty string among keys, or undefined.
 * @param r Source record.
 * @param keys Preference order.
 */
function firstStringField(
  r: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = r[key];
    if (v != null && String(v).length > 0) {
      return String(v);
    }
  }
  return undefined;
}
