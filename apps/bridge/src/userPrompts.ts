/**
 * User-prompt store ops: get / set / clear / move over managed markdown files.
 * Paths come from userPromptsPaths; disk I/O from userPromptsIo.
 */

import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  normalizeEntryText,
  parsePrompts,
  serializePrompts,
  type PromptEntry,
  type PromptScope,
} from "./userPromptsFormat.js";
import {
  atomicWrite,
  assertManagedOrAbsent,
  foreignError,
} from "./userPromptsIo.js";
import {
  assertScope,
  ensureLocalExclude,
  isLocalExcluded,
  resolveGrokHome,
  resolveProjectRoot,
  scopePath,
  type PromptScopeState,
  type PromptWriteResult,
  type PromptsSnapshot,
} from "./userPromptsPaths.js";

export {
  GLOBAL_FILE,
  LOCAL_EXCLUDE_LINE,
  PROJECT_LOCAL_FILE,
  assertScope,
  ensureLocalExclude,
  isLocalExcluded,
  resolveGrokHome,
  resolveProjectRoot,
  scopePath,
  type PromptScopeState,
  type PromptWriteResult,
  type PromptsSnapshot,
} from "./userPromptsPaths.js";
export { atomicWrite } from "./userPromptsIo.js";

/**
 * Read one scope file into PromptScopeState (no throw on missing).
 * @param scope Layer id.
 * @param filePath Absolute path.
 */
export function readScopeState(
  scope: PromptScope,
  filePath: string,
): PromptScopeState {
  if (!existsSync(filePath)) {
    return {
      scope,
      path: filePath,
      exists: false,
      foreign: false,
      entries: [],
      bytes: 0,
    };
  }
  let content = "";
  let bytes = 0;
  try {
    const buf = readFileSync(filePath);
    bytes = buf.byteLength;
    content = buf.toString("utf8");
  } catch (err) {
    throw new Error(
      `failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = parsePrompts(content);
  if (parsed.foreign) {
    return {
      scope,
      path: filePath,
      exists: true,
      foreign: true,
      entries: [],
      bytes,
    };
  }
  return {
    scope,
    path: filePath,
    exists: true,
    foreign: false,
    entries: parsed.entries,
    bytes,
  };
}

/**
 * Load full three-scope snapshot for prompts_get.
 * @param cwd Session workspace (used only to resolve project root).
 */
export function promptsGet(cwd?: string): PromptsSnapshot {
  const grokHome = resolveGrokHome();
  const work = path.resolve(cwd || process.cwd());
  const { projectRoot, gitRepo } = resolveProjectRoot(work);
  const localExcluded = gitRepo ? isLocalExcluded(projectRoot) : false;
  return {
    projectRoot: projectRoot || null,
    gitRepo,
    localExcluded,
    global: readScopeState("global", scopePath("global", grokHome, projectRoot)),
    project: readScopeState(
      "project",
      scopePath("project", grokHome, projectRoot),
    ),
    projectLocal: readScopeState(
      "projectLocal",
      scopePath("projectLocal", grokHome, projectRoot),
    ),
  };
}

/**
 * Full-list write for one scope. Empty entries → unlink (clear).
 * @param scope Layer to write.
 * @param entries Structured entries (text already normalized preferred).
 * @param cwd Workspace for project root.
 */
export function promptsSet(
  scope: PromptScope,
  entries: PromptEntry[],
  cwd?: string,
): PromptWriteResult {
  assertScope(scope);
  const normalized = normalizeEntries(entries);
  const grokHome = resolveGrokHome();
  const work = path.resolve(cwd || process.cwd());
  const { projectRoot, gitRepo } = resolveProjectRoot(work);
  const filePath = scopePath(scope, grokHome, projectRoot);

  if (scope === "projectLocal" && gitRepo) {
    ensureLocalExclude(projectRoot);
  }

  if (normalized.length === 0) {
    return promptsClear(scope, cwd);
  }

  const body = serializePrompts(normalized);
  if (body === null) {
    return promptsClear(scope, cwd);
  }

  assertManagedOrAbsent(filePath);
  atomicWrite(filePath, body);
  return {
    scope,
    path: filePath,
    bytes: Buffer.byteLength(body, "utf8"),
    removed: false,
  };
}

/**
 * Unlink managed file for one scope (idempotent when already absent).
 * @param scope Layer to clear.
 * @param cwd Workspace for project root.
 */
export function promptsClear(scope: PromptScope, cwd?: string): PromptWriteResult {
  assertScope(scope);
  const grokHome = resolveGrokHome();
  const work = path.resolve(cwd || process.cwd());
  const { projectRoot } = resolveProjectRoot(work);
  const filePath = scopePath(scope, grokHome, projectRoot);

  if (!existsSync(filePath)) {
    return { scope, path: filePath, bytes: 0, removed: false };
  }
  assertManagedOrAbsent(filePath);
  try {
    unlinkSync(filePath);
  } catch (err) {
    throw new Error(
      `failed to remove ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { scope, path: filePath, bytes: 0, removed: true };
}

/**
 * Atomically move one entry from `from` scope to `to` scope by index.
 * Writes destination first, then source; rolls destination back on source failure.
 * @param from Source scope.
 * @param to Destination scope.
 * @param entryIndex 0-based index in source entries.
 * @param cwd Workspace.
 */
export function promptsMove(
  from: PromptScope,
  to: PromptScope,
  entryIndex: number,
  cwd?: string,
): { from: PromptWriteResult; to: PromptWriteResult } {
  assertScope(from);
  assertScope(to);
  if (from === to) {
    throw new Error("prompts_move: from and to scopes must differ");
  }
  const grokHome = resolveGrokHome();
  const work = path.resolve(cwd || process.cwd());
  const { projectRoot, gitRepo } = resolveProjectRoot(work);
  const fromPath = scopePath(from, grokHome, projectRoot);
  const toPath = scopePath(to, grokHome, projectRoot);

  const fromState = readScopeState(from, fromPath);
  const toState = readScopeState(to, toPath);
  if (fromState.foreign) {
    throw foreignError(fromPath);
  }
  if (toState.foreign) {
    throw foreignError(toPath);
  }
  if (
    entryIndex < 0 ||
    entryIndex >= fromState.entries.length ||
    !Number.isInteger(entryIndex)
  ) {
    throw new Error(`prompts_move: entryIndex ${entryIndex} out of range`);
  }

  const entry = fromState.entries[entryIndex];
  if (!entry) {
    throw new Error(`prompts_move: entryIndex ${entryIndex} out of range`);
  }
  const nextFrom = fromState.entries.filter((_, i) => i !== entryIndex);
  const nextTo = [...toState.entries, { ...entry, id: entry.id }];

  // Capture original `to` for rollback.
  const toExisted = toState.exists;
  const toOriginal = toExisted ? readFileSync(toPath) : null;

  if (to === "projectLocal" && gitRepo) {
    ensureLocalExclude(projectRoot);
  }

  // Write destination first (duplicate on mid-failure is better than loss).
  const toBody = serializePrompts(nextTo);
  if (toBody === null) {
    throw new Error("prompts_move: unexpected empty destination serialize");
  }
  atomicWrite(toPath, toBody);

  try {
    if (nextFrom.length === 0) {
      if (existsSync(fromPath)) {
        assertManagedOrAbsent(fromPath);
        unlinkSync(fromPath);
      }
    } else {
      const fromBody = serializePrompts(nextFrom);
      if (fromBody === null) {
        throw new Error("prompts_move: unexpected empty source serialize");
      }
      atomicWrite(fromPath, fromBody);
    }
  } catch (err) {
    // Roll back destination.
    try {
      if (toOriginal === null) {
        if (existsSync(toPath)) {
          unlinkSync(toPath);
        }
      } else {
        atomicWrite(toPath, toOriginal);
      }
    } catch {
      // Best-effort rollback; surface original error.
    }
    throw err;
  }

  const fromRemoved = nextFrom.length === 0;
  const fromBytes = fromRemoved
    ? 0
    : Buffer.byteLength(serializePrompts(nextFrom) ?? "", "utf8");
  const toBytes = Buffer.byteLength(toBody, "utf8");
  return {
    from: {
      scope: from,
      path: fromPath,
      bytes: fromBytes,
      removed: fromRemoved && fromState.exists,
    },
    to: {
      scope: to,
      path: toPath,
      bytes: toBytes,
      removed: false,
    },
  };
}

/**
 * Normalize every entry text; throw on first validation failure.
 * @param entries Raw client entries.
 */
function normalizeEntries(entries: PromptEntry[]): PromptEntry[] {
  const out: PromptEntry[] = [];
  for (const e of entries) {
    const n = normalizeEntryText(e.text);
    if (!n.ok) {
      throw new Error(n.reason);
    }
    out.push({
      id: String(e.id ?? ""),
      text: n.text,
      enabled: e.enabled !== false,
      ...(e.category ? { category: e.category } : {}),
    });
  }
  return out;
}

/**
 * File size in bytes when present, else 0.
 * @param filePath Path to stat.
 */
export function fileBytes(filePath: string): number {
  try {
    if (!existsSync(filePath)) {
      return 0;
    }
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
