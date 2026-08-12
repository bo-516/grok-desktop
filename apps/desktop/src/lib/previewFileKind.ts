/**
 * Classify a preview target path as document (Markdown render) or code (line-numbered).
 * Pure whitelist on the final extension only — no content sniffing.
 * Misclassifying as code is safe (today's view); misclassifying as doc is not.
 */

/** Extensions (lowercase, no dot) that open in the rendered document view. */
const DOC_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

/**
 * Soft upper bound for Streamdown static render of a whole file.
 * Above this, the file orchestrator forces source mode with a banner.
 * 200k chars ≈ dense multi-thousand-line docs; larger files are usually generated.
 */
export const DOC_RENDER_MAX_CHARS = 200_000;

/**
 * Final path segment extension without the leading dot, lowercased.
 * @param path Absolute or relative file path; may be empty.
 * @returns Extension string, or "" when there is no final extension segment
 *   (e.g. "README", "README.md.bak" → "bak", ".gitignore" → "gitignore").
 */
export function extensionOfPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const base = trimmed.replace(/^.*[/\\]/, "");
  const dot = base.lastIndexOf(".");
  // Leading-dot only names (".env") have no extension for our purposes.
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether a preview path should use the document renderer.
 * @param path Absolute or relative file path; no extension / unknown / empty → code.
 * @returns `"doc"` for Markdown whitelist extensions, otherwise `"code"`.
 */
export function previewFileKind(path: string): "doc" | "code" {
  const ext = extensionOfPath(path);
  if (DOC_EXTENSIONS.has(ext)) {
    return "doc";
  }
  return "code";
}
