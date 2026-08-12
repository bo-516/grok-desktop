/**
 * Resolve workspace-relative Markdown link targets against the open document.
 * Pure path math for the preview drawer — no I/O, no React.
 */

/**
 * Resolve a relative href against the directory of the currently open file.
 * Absolute paths (Unix `/…` or Windows `C:\…`) are returned unchanged.
 * @param baseFile Absolute or workspace-relative path of the open document.
 * @param href Relative or absolute target from a Markdown link.
 * @returns Normalized path using forward slashes (bridge paths are POSIX-like).
 */
export function resolveDocRelativePath(baseFile: string, href: string): string {
  const target = href.trim();
  if (!target) {
    return baseFile;
  }
  // Absolute POSIX or Windows drive path — do not resolve against the base.
  if (target.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target)) {
    return normalizeSlashes(target);
  }
  const base = baseFile.replace(/[/\\]+$/, "");
  const lastSep = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const dir = lastSep >= 0 ? base.slice(0, lastSep) : "";
  const joined = dir ? `${dir}/${target}` : target;
  return normalizePathSegments(joined);
}

/**
 * Collapse `.` / `..` segments and unify separators to `/`.
 * @param path Possibly mixed-separator path (relative or absolute).
 */
function normalizePathSegments(path: string): string {
  const abs = path.startsWith("/");
  const parts = path.split(/[/\\]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!abs) {
        out.push("..");
      }
      continue;
    }
    out.push(part);
  }
  const body = out.join("/");
  return abs ? `/${body}` : body;
}

/**
 * Replace backslashes with forward slashes without rewriting segments.
 * @param path Raw path that may use Windows separators.
 */
function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Build a stable heading id from visible text (GitHub-ish slug).
 * @param text Plain heading text (no Markdown markers).
 * @returns Lowercase slug safe for `id` / `#anchor` scroll targets; empty when
 *   there is no usable text (caller should omit `id` rather than invent one).
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug;
}
