/**
 * Session irreversible / fork / rewind action helpers (F-SESS-11/13, J-05).
 * Pure builders for command text + confirm prompts; bridge executes via prompt/cli.
 */

import {
  buildConfirmPrompt,
  type ConfirmPrompt,
} from "./confirmAction";

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
 * Normalize `grok sessions list --json` payload into catalog-friendly rows.
 * @param data CLI JSON or { raw, lines }.
 */
export function normalizeSessionsList(data: unknown): Array<{
  id: string;
  title: string;
  workspace?: string;
  updatedAt?: string;
}> {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data
      .map((row) => normalizeOneSession(row))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  }
  if (typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const list = rec.sessions ?? rec.items ?? rec.data;
    if (Array.isArray(list)) {
      return list
        .map((row) => normalizeOneSession(row))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
    }
    if (typeof rec.raw === "string") {
      return String(rec.raw)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // uuid-ish first token
          const m = line.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
          );
          if (!m) {
            return null;
          }
          return { id: m[1]!, title: line };
        })
        .filter((r): r is { id: string; title: string } => Boolean(r));
    }
  }
  return [];
}

function normalizeOneSession(
  row: unknown,
): { id: string; title: string; workspace?: string; updatedAt?: string } | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, unknown>;
  const id = String(r.id ?? r.sessionId ?? r.session_id ?? "").trim();
  if (!id) {
    return null;
  }
  const title = String(r.title ?? r.name ?? id).trim() || id;
  const workspace = r.cwd
    ? String(r.cwd)
    : r.workspace
      ? String(r.workspace)
      : undefined;
  const updatedAt = r.updatedAt
    ? String(r.updatedAt)
    : r.updated_at
      ? String(r.updated_at)
      : undefined;
  return { id, title, workspace, updatedAt };
}
