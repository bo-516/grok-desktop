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
import { normalizeCatalog, type SessionRecord } from "@/store/sessionCatalog";
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
  /**
   * Upstream session role (subagent / subagent_resume / subagent_fork).
   * Absent for ordinary chats.
   */
  sessionKind?: string;
  /** Parent session id when this row is a harness-spawned subagent. */
  parentSessionId?: string;
};

/**
 * Whether a session_kind marks a harness-spawned subagent chat.
 * Prefix match covers subagent / subagent_resume / subagent_fork; unknown
 * or absent kinds stay visible as user chats (safer than hiding them).
 * @param kind Raw session_kind value, possibly undefined.
 * @returns True when the row should be hidden from the session rail.
 */
export function isSubagentSessionKind(kind: string | undefined): boolean {
  return typeof kind === "string" && kind.startsWith("subagent");
}

/**
 * Whether a catalog row has content worth listing on the session rail.
 * Local messages (non-empty timeline) always count. Remote `sessions_list`
 * rows keep an empty timeline until hydrate — a non-weak title is treated as
 * proof of on-disk content so those chats stay visible. Empty drafts /
 * untitled ghosts (weak title + no timeline) are excluded.
 * @param rec Catalog session row.
 * @returns True when the row should appear in the rail list.
 */
export function sessionHasRailContent(rec: SessionRecord): boolean {
  if ((rec.timeline?.length ?? 0) > 0) {
    return true;
  }
  return !isWeakSessionTitle(rec.title);
}

/**
 * Filter catalog rows for the session rail: hide harness subagent kinds and
 * empty (no-message) drafts, then optionally apply the search query.
 * Subagent rows remain in the full catalog so selectSession(childSessionId)
 * still resolves.
 * @param catalog Full session catalog (including subagent rows).
 * @param query Free-text search over title and workspace; empty = all listed chats.
 * @returns Rows safe to group/render in the rail.
 */
export function filterCatalogForSessionRail(
  catalog: SessionRecord[],
  query = "",
): SessionRecord[] {
  const userChats = catalog.filter(
    (s) =>
      !isSubagentSessionKind(s.sessionKind) && sessionHasRailContent(s),
  );
  const q = query.trim().toLowerCase();
  if (!q) {
    return userChats;
  }
  return userChats.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.workspace.toLowerCase().includes(q),
  );
}

/**
 * Whether selectSessionAction can resolve a catalog id (no early-return).
 * Pure predicate used by navigation tests; production still uses catalog.find.
 * @param catalog Full catalog including subagent rows.
 * @param id Session id to open (may be a childSessionId).
 * @returns True when the id is present and select will not early-return.
 */
export function canSelectCatalogSession(
  catalog: SessionRecord[],
  id: string,
): boolean {
  return catalog.some((s) => s.id === id);
}

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
 * - Workspace is filled when the local row is missing one, except for rows
 *   marked `noProject` (they must stay unfiled).
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
      let strongTitle = existing.title;
      if (isWeakSessionTitle(existing.title)) {
        const remoteTitle = row.title?.trim();
        if (remoteTitle && !isWeakSessionTitle(remoteTitle)) {
          strongTitle = remoteTitle;
        }
      }
      byId.set(row.id, {
        ...existing,
        /*
         * Chats started with "No project" keep an empty workspace: on disk they
         * sit under the bridge's own cwd, so backfilling that path here would
         * silently move them into a real project folder on the next sync.
         */
        workspace: existing.noProject
          ? ""
          : existing.workspace || row.workspace || "",
        title: strongTitle,
        updatedAt: Math.max(existing.updatedAt, remoteUpdated ?? 0),
        createdAt: existing.createdAt || remoteCreated || existing.updatedAt,
        // Backfill role fields on existing rows so historical catalog gains them.
        sessionKind: row.sessionKind ?? existing.sessionKind,
        parentSessionId: row.parentSessionId ?? existing.parentSessionId,
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
      sessionKind: row.sessionKind,
      parentSessionId: row.parentSessionId,
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
 * Accepts camelCase and snake_case role fields from bridge / disk.
 * @param row Unknown list element.
 * @returns Catalog-friendly remote row, or null when id is missing.
 */
export function normalizeOneSession(row: unknown): RemoteSessionRow | null {
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
  const sessionKind = firstStringField(r, ["sessionKind", "session_kind"]);
  const parentSessionId = firstStringField(r, [
    "parentSessionId",
    "parent_session_id",
  ]);
  return {
    id,
    title,
    workspace,
    updatedAt,
    createdAt,
    sessionKind,
    parentSessionId,
  };
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
