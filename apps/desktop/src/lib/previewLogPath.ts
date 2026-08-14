/**
 * Preview sandbox for background-task logs.
 *
 * grok-build writes `output_file` under
 * `<GROK_HOME>/sessions/<encoded-cwd>/<sessionId>/terminal/`, which sits
 * outside the project workspace. `previewWorkspaceFile` rejects any path
 * outside its cwd, so the Agents row must sandbox the read to the log's
 * parent directory rather than the session workspace.
 */

/**
 * Parent directory of a filesystem path (POSIX or Windows separators).
 * @param path Absolute or relative file path; empty stays empty.
 * @returns Directory without a trailing separator, or "" when the path has
 *   no parent segment (a bare file name). Unix `/file` yields `/`.
 */
export function parentDirOfPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const lastSlash = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  if (lastSlash < 0) {
    return "";
  }
  if (lastSlash === 0) {
    return "/";
  }
  return trimmed.slice(0, lastSlash);
}

/**
 * Whether `path` is an absolute filesystem location (POSIX or Windows drive).
 * @param path Candidate path; leading/trailing space is ignored.
 */
export function isAbsoluteFsPath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);
}

/**
 * Cwd to pass to `previewWorkspaceFile` for one background-task log.
 *
 * Absolute logs (the grok-build shape) use the log's parent so the existing
 * workspace reader accepts `<session>/terminal/*.log`. Relative logs are
 * unusual and stay bound to the project workspace.
 *
 * @param outputFile Absolute or relative log path from the task card.
 * @param workspace Session project workspace; used only when the log is
 *   relative or has no parent directory.
 * @returns Sandbox root for the preview read, or undefined when neither the
 *   log parent nor the workspace is usable.
 */
export function previewLogReadCwd(
  outputFile: string,
  workspace?: string,
): string | undefined {
  const fallback = workspace?.trim() || undefined;
  const path = outputFile.trim();
  if (!path) {
    return fallback;
  }
  if (!isAbsoluteFsPath(path)) {
    return fallback;
  }
  const parent = parentDirOfPath(path);
  return parent || fallback;
}
