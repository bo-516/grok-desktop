/**
 * Last-known grok-build slash catalog: persist, inspect-skill fill, and seed.
 * Composer `/` and New chat drafts must not wait for the next session/new.
 * Desktop pager commands (`/model`, `/effort`) are always merged in — ACP
 * does not advertise them, and a skills-only update must not hide builtins.
 */

import {
  normalizeAvailableCommands,
  type AvailableCommand,
  type SessionState,
} from "@grok-desktop/acp-core";
import { desktopSlashCommands } from "@/lib/slashBuiltins";

/** localStorage key for the last non-shrinking live slash catalog. */
export const SLASH_CATALOG_STORAGE_KEY = "grok-desktop.slash-catalog.v1";

/**
 * Inspect skill slice needed to fill `/` before session/new advertises skills.
 * Matches Environment `SkillRow` without importing that module (no cycle).
 */
export type SlashInspectSkill = {
  name: string;
  description?: string;
  userInvocable?: boolean;
  source?: { kind?: string; path?: string };
};

/**
 * Read the persisted slash catalog.
 * Corrupt JSON or a missing store yields [] so callers can fall through to inspect.
 * @returns Normalized commands; empty when nothing usable is stored.
 */
export function loadSlashCatalog(): AvailableCommand[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(SLASH_CATALOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizeAvailableCommands(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * Persist a slash catalog by unioning names with the stored list.
 * Skills-only `available_commands_update` frames must not drop initialize
 * builtins (`compact`, …) just because the new list is longer.
 * @param commands Live or merged catalog; empty / undefined is ignored.
 * @returns true when storage changed.
 */
export function rememberSlashCatalog(
  commands: AvailableCommand[] | undefined,
): boolean {
  const incoming = normalizeAvailableCommands(commands);
  if (incoming.length === 0) {
    return false;
  }
  const prev = loadSlashCatalog();
  const next = unionSlashCatalogs(prev, incoming);
  if (slashCatalogsEqual(prev, next)) {
    return false;
  }
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    localStorage.setItem(SLASH_CATALOG_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Map inspect invocable skills onto AvailableCommand rows for the `/` menu.
 * Non-invocable skills stay out — they are not valid composer tokens.
 * @param skills Environment inspect skill rows; non-arrays yield [].
 * @returns Deduped commands tagged with scope/path so the menu marks them as skills.
 */
export function commandsFromInspectSkills(
  skills: SlashInspectSkill[] | undefined,
): AvailableCommand[] {
  if (!Array.isArray(skills) || skills.length === 0) {
    return [];
  }
  const raw = skills
    .filter((skill) => skill && skill.userInvocable === true)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      _meta: {
        scope: skill.source?.kind,
        path: skill.source?.path,
      },
    }));
  return normalizeAvailableCommands(raw);
}

/**
 * Deduped concatenation; first list wins on a repeated name.
 * @param lists Catalog slices in priority order; undefined / empty slices skip.
 * @returns Normalized commands with unique names.
 */
export function unionSlashCatalogs(
  ...lists: Array<AvailableCommand[] | undefined>
): AvailableCommand[] {
  const names = new Set<string>();
  const out: AvailableCommand[] = [];
  for (const list of lists) {
    for (const command of normalizeAvailableCommands(list)) {
      if (names.has(command.name)) {
        continue;
      }
      names.add(command.name);
      out.push(command);
    }
  }
  return out;
}

/**
 * Whether a catalog row is an inspect / agent skill (scope or path on `_meta`).
 * Used so a stale cached skill does not float above the live list.
 * @param command Normalized available-command row.
 * @returns true when skill metadata is present.
 */
function commandHasSkillMeta(command: AvailableCommand): boolean {
  const scope = command._meta?.scope;
  const skillPath = command._meta?.path;
  return typeof scope === "string" || typeof skillPath === "string";
}

/**
 * Resolve the `/` catalog for a canvas that may not have finished handshake.
 * Desktop pager commands (`/model`, `/effort`) always lead so visual chrome
 * is not the only way to change them. Then: live handshake (or full cache
 * when live is empty), recovered non-skill cache extras (initialize builtins
 * dropped by a skills-only update), then inspect invocable skills.
 * @param live SessionState.availableCommands from the current canvas.
 * @param cached Result of {@link loadSlashCatalog}; pass [] when unused.
 * @param inspectSkills Environment inspect skills; only userInvocable rows merge.
 * @returns Deduped catalog; desktop builtins first, then agent / inspect rows.
 */
export function resolveSlashCatalog(
  live: AvailableCommand[] | undefined,
  cached: AvailableCommand[] | undefined,
  inspectSkills: SlashInspectSkill[] | undefined,
): AvailableCommand[] {
  const liveNorm = normalizeAvailableCommands(live);
  const cachedNorm = normalizeAvailableCommands(cached);
  const desktop = desktopSlashCommands();
  const inspect = commandsFromInspectSkills(inspectSkills);
  if (liveNorm.length === 0) {
    return unionSlashCatalogs(desktop, cachedNorm, inspect);
  }
  const reserved = new Set([
    ...desktop.map((command) => command.name),
    ...liveNorm.map((command) => command.name),
  ]);
  const recovered = cachedNorm.filter(
    (command) => !reserved.has(command.name) && !commandHasSkillMeta(command),
  );
  return unionSlashCatalogs(desktop, recovered, liveNorm, inspect);
}

/**
 * Attach a cached slash catalog onto a session that has none.
 * Used by New chat and catalog select so `/` works before handshake.
 * @param session Canvas snapshot; returned as-is when it already has commands.
 * @returns Session with availableCommands filled from cache when needed.
 */
export function withCachedSlashCatalog(session: SessionState): SessionState {
  if (session.availableCommands && session.availableCommands.length > 0) {
    return session;
  }
  const cached = loadSlashCatalog();
  if (cached.length === 0) {
    return session;
  }
  return { ...session, availableCommands: cached };
}

/**
 * Structural equality for persist skip (name + description + input hint).
 * @param left Previous stored catalog.
 * @param right Candidate catalog.
 * @returns true when both lists match in order.
 */
function slashCatalogsEqual(
  left: AvailableCommand[],
  right: AvailableCommand[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.name !== b.name ||
      a.description !== b.description ||
      (a.input?.hint ?? "") !== (b.input?.hint ?? "")
    ) {
      return false;
    }
  }
  return true;
}
