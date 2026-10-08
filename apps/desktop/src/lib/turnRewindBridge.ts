/**
 * Typed calls for the bridge `rewind_*` cli commands (grok-build's own
 * per-prompt file checkpoints, mode files_only). Pure over the runner, like
 * gitBridge: transport / agent failures throw the bridge text verbatim; a
 * rewind that grok-build refused (outside edits without force) resolves with
 * `success: false` so the dialog can show the conflicts.
 */

import type { GitCliRunner } from "./gitBridge";
import type { RewindPoint } from "./turnRewind";

/** File changed outside the agent after its last edit. */
export type RewindConflict = {
  /** Path as grok-build reports it (workspace-relative inside cwd). */
  path: string;
  /** modified_externally / created_externally / deleted_externally. */
  type: string;
};

/** Normalized `rewind_files` reply. */
export type RewindResult = {
  /** True when grok-build applied the restore. */
  success: boolean;
  /** Boundary that was (or would have been) restored. */
  targetPromptIndex: number;
  /** Files restored by grok-build. */
  revertedFiles: string[];
  /** Files that would restore cleanly (refusals only). */
  cleanFiles: string[];
  /** Files changed outside the agent (block the restore unless forced). */
  conflicts: RewindConflict[];
  /** Files the rewound turns created, removed by the bridge. */
  deletedFiles: string[];
  /** Non-fatal bridge notes (a file left in place, …). */
  warnings: string[];
  /** grok-build's refusal text ("" on success). */
  error: string;
};

/**
 * Coerce an unknown array to strings.
 * @param v Value.
 * @returns Non-empty strings.
 */
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/**
 * Coerce the `rewind_points` payload.
 * @param data Bridge data ([]Point).
 * @returns Points with sane fields; malformed rows dropped.
 */
export function normalizeRewindPoints(data: unknown): RewindPoint[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((row): RewindPoint[] => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const o = row as Record<string, unknown>;
    if (typeof o.promptIndex !== "number" || !Number.isInteger(o.promptIndex) || o.promptIndex < 0) {
      return [];
    }
    const fileCount = typeof o.fileCount === "number" ? o.fileCount : 0;
    return [
      {
        promptIndex: o.promptIndex,
        preview: typeof o.preview === "string" ? o.preview : "",
        createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
        fileCount,
        hasFileChanges: o.hasFileChanges === true || fileCount > 0,
      },
    ];
  });
}

/**
 * Coerce the `rewind_files` payload.
 * @param data Bridge data (rewind.Result).
 * @returns Result; a non-object payload is a refusal with a generic error.
 */
export function normalizeRewindResult(data: unknown): RewindResult {
  const o = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const conflicts = Array.isArray(o?.conflicts) ? o.conflicts : [];
  const success = o?.success === true;
  const error = typeof o?.error === "string" ? o.error : "";
  return {
    success,
    targetPromptIndex: typeof o?.targetPromptIndex === "number" ? o.targetPromptIndex : -1,
    revertedFiles: strings(o?.revertedFiles),
    cleanFiles: strings(o?.cleanFiles),
    conflicts: conflicts.flatMap((c): RewindConflict[] => {
      const r = c && typeof c === "object" ? (c as Record<string, unknown>) : null;
      return r && typeof r.path === "string" && r.path
        ? [{ path: r.path, type: typeof r.type === "string" ? r.type : "" }]
        : [];
    }),
    deletedFiles: strings(o?.deletedFiles),
    warnings: strings(o?.warnings),
    error: success ? "" : error || "grok-build did not restore the files",
  };
}

/**
 * Run a rewind command and unwrap its data.
 * @param run Cli runner.
 * @param command `rewind_points` / `rewind_files`.
 * @param args Args (always carries sessionId).
 * @param cwd Session workspace (routing only; the bridge uses the runtime cwd).
 * @returns Reply data.
 */
async function call(
  run: GitCliRunner,
  command: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<unknown> {
  const reply = await run(command, args, cwd);
  if (!reply.ok) {
    throw new Error(reply.error?.trim() || `${command} failed`);
  }
  return reply.data;
}

/**
 * List the session's rewind boundaries.
 * @param run Cli runner (liveGitRunner in the app).
 * @param cwd Session workspace.
 * @param sessionId Live session id.
 * @returns Points.
 */
export async function fetchRewindPoints(
  run: GitCliRunner,
  cwd: string,
  sessionId: string,
): Promise<RewindPoint[]> {
  return normalizeRewindPoints(await call(run, "rewind_points", { sessionId }, cwd));
}

/**
 * Restore files to the state before a prompt (that turn and all later ones).
 * @param run Cli runner.
 * @param cwd Session workspace.
 * @param req Session, boundary, and force (overwrite outside edits).
 * @returns Result (success false = refused, see conflicts).
 */
export async function runRewindFiles(
  run: GitCliRunner,
  cwd: string,
  req: { sessionId: string; targetPromptIndex: number; force: boolean },
): Promise<RewindResult> {
  return normalizeRewindResult(await call(run, "rewind_files", req, cwd));
}
