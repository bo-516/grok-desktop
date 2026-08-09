/**
 * Background task panel model (F-BG-01/02/06).
 * Derives task rows from terminal reverse handles + slash /tasks /loop commands.
 */

export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";

export type BackgroundTask = {
  id: string;
  label: string;
  status: BackgroundTaskStatus;
  /** Optional command line. */
  command?: string;
  /** Exit code when completed. */
  exitCode?: number | null;
  outputPreview?: string;
};

/**
 * Normalize terminal registry / agent payloads into task rows.
 * @param raw Array of terminal or task objects.
 */
export function normalizeBackgroundTasks(raw: unknown): BackgroundTask[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: BackgroundTask[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const r = item as Record<string, unknown>;
    const id = String(r.id ?? r.terminalId ?? r.taskId ?? `task-${i}`);
    const label = String(r.label ?? r.command ?? r.title ?? id);
    const status = normalizeStatus(r.status ?? r.state);
    out.push({
      id,
      label,
      status,
      command: r.command ? String(r.command) : undefined,
      exitCode:
        typeof r.exitCode === "number" || r.exitCode === null
          ? (r.exitCode as number | null)
          : undefined,
      outputPreview: pickOutputPreview(r),
    });
  });
  return out;
}

/**
 * Prefer full output tail, else a dedicated preview field.
 * @param r Raw task/terminal object fields.
 */
function pickOutputPreview(r: Record<string, unknown>): string | undefined {
  if (typeof r.output === "string") {
    return r.output.slice(-200);
  }
  if (typeof r.outputPreview === "string") {
    return r.outputPreview;
  }
  return undefined;
}

function normalizeStatus(raw: unknown): BackgroundTaskStatus {
  const s = String(raw ?? "running").toLowerCase();
  if (s.includes("kill") || s === "cancelled") {
    return "killed";
  }
  if (s.includes("fail") || s === "error") {
    return "failed";
  }
  if (s.includes("complete") || s === "done" || s === "exited") {
    return "completed";
  }
  return "running";
}

/**
 * Slash command to kill a background task by id (agent-side).
 * @param taskId Task id.
 */
export function buildKillTaskCommand(taskId: string): string {
  return `/tasks kill ${taskId}`;
}

/**
 * Slash command to open tasks panel listing.
 */
export function buildListTasksCommand(): string {
  return "/tasks";
}
