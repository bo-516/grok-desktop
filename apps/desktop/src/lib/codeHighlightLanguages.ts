/**
 * Grammar registry for syntax highlighting: which languages the shell can
 * highlight, and how a file path or Markdown fence info-string maps onto one.
 *
 * Every grammar is a lazy `import()` so a language costs nothing until a file
 * of that type is actually previewed — the registry itself is only a table of
 * thunks. Adding a language means one row here plus its extensions/aliases; no
 * other file changes. A path with no row highlights as plain text rather than
 * failing, so an unlisted extension degrades instead of breaking the preview.
 */

import type { LanguageRegistration } from "shiki/core";

/** Module shape of a `@shikijs/langs/*` entry point. */
type LangModule = { default: LanguageRegistration[] };

/**
 * Shiki grammar id → loader. Keys are the ids passed to `codeToTokens`, so they
 * must match Shiki's own language ids exactly; a typo surfaces as a "language
 * not loaded" throw at highlight time, not at build time.
 */
const LANGUAGE_LOADERS = {
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  python: () => import("@shikijs/langs/python"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  markdown: () => import("@shikijs/langs/markdown"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  diff: () => import("@shikijs/langs/diff"),
} satisfies Record<string, () => Promise<LangModule>>;

/** Grammar ids this shell can highlight; anything else renders as plain text. */
export type CodeLanguage = keyof typeof LANGUAGE_LOADERS;

/**
 * Load one grammar's registration array.
 * @param language Grammar id from {@link CodeLanguage}.
 * @returns The grammar registrations Shiki's `loadLanguage` expects.
 */
export async function loadLanguageGrammar(
  language: CodeLanguage,
): Promise<LanguageRegistration[]> {
  const module = await LANGUAGE_LOADERS[language]();
  return module.default;
}

/**
 * Lowercased file extension (no dot) → grammar id. Extensions absent here fall
 * through to plain text, which is the correct outcome for data/binary-ish files
 * the bridge still hands over as text (.lock, .csv, …).
 */
const EXTENSION_LANGUAGES: Record<string, CodeLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  go: "go",
  rs: "rust",
  py: "python",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

/**
 * Markdown fence info-string / user-typed alias → grammar id. Covers the short
 * names agents actually emit (```ts, ```sh) which are not file extensions.
 */
const ALIAS_LANGUAGES: Record<string, CodeLanguage> = {
  ...EXTENSION_LANGUAGES,
  typescript: "typescript",
  javascript: "javascript",
  golang: "go",
  rust: "rust",
  python: "python",
  shell: "shellscript",
  shellscript: "shellscript",
  console: "shellscript",
  markdown: "markdown",
  yml: "yaml",
};

/**
 * Resolve the grammar for a file path by extension.
 * @param path Absolute or workspace-relative path; only the last segment matters.
 * @returns Grammar id, or null when the extension is unknown / absent (dotfiles
 *   such as `.gitignore` intentionally return null rather than guessing).
 */
export function languageForPath(path: string | undefined): CodeLanguage | null {
  const name = (path ?? "").split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return EXTENSION_LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Resolve the grammar from a Markdown code element's class list.
 * @param className Class string Streamdown puts on fenced `<code>`, e.g.
 *   "language-tsx"; inline code has no such class and yields null.
 * @returns Grammar id, or null for inline code / unknown fence languages.
 */
export function languageForFenceClass(
  className: string | undefined,
): CodeLanguage | null {
  const match = /(?:^|\s)language-([\w+#-]+)/.exec(className ?? "");
  if (!match) {
    return null;
  }
  return ALIAS_LANGUAGES[match[1].toLowerCase()] ?? null;
}
