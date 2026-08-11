/**
 * Shared Shiki highlighter behind the preview drawer, the structured diff, and
 * Markdown fences.
 *
 * Two deliberate choices shape this module:
 *
 * 1. Fine-grained bundle. `createHighlighterCore` + per-language `import()`
 *    (see codeHighlightLanguages.ts) plus the JS RegExp engine keep both the
 *    full-bundle grammar table and the Oniguruma WASM blob out of the shell.
 * 2. CSS-variables theme. Shiki is asked for semantic variables rather than a
 *    theme's hex values, so tokens come back tagged with a *kind* and colors
 *    stay in defineColor.css (`--color-code-*`). This is what lets business TSX
 *    honour the repo's "no color literals / no color inline style" rule while
 *    still wearing a real VS Code theme's palette, and what makes light mode
 *    work without re-tokenizing.
 *
 * Everything here is pure or memoized module state; React integration lives in
 * `widgets/shared/useCodeHighlight.ts`.
 */

import type { HighlighterCore, ThemedToken, ThemeRegistration } from "shiki/core";
import {
  loadLanguageGrammar,
  type CodeLanguage,
} from "./codeHighlightLanguages";

/**
 * Semantic token kinds the theme can emit. "plain" covers both unstyled runs
 * and any variable we do not map, so rendering never has to handle an unknown
 * kind.
 *
 * The set matches the distinctions VS Code's default themes actually draw —
 * control flow apart from declaration keywords, types apart from functions,
 * identifiers apart from body text — because a palette that collapses them
 * stops reading as Dark+ / Light+ no matter how exact the hexes are.
 */
export type CodeTokenKind =
  | "plain"
  | "keyword"
  | "control"
  | "type"
  | "tag"
  | "string"
  | "string-expression"
  | "comment"
  | "constant"
  | "number"
  | "function"
  | "punctuation"
  | "variable"
  | "parameter"
  | "link";

/** One styled run within a line; `content` is raw text, never HTML. */
export type CodeToken = {
  content: string;
  kind: CodeTokenKind;
  /**
   * 0-based character offset of this run in the whole source. Unique across the
   * file, so it is the React key for token spans — index keys would reuse a
   * span across re-tokenizes when a run splits or merges.
   */
  offset: number;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
};

/** Tokens of a single source line, in order; an empty line is an empty array. */
export type CodeLine = CodeToken[];

/**
 * Size guards. The bridge already truncates reads at 1MB, which is still far
 * more than TextMate tokenization can chew through on the main thread without a
 * visible stall, so highlighting bails to plain text beyond these limits rather
 * than freezing the drawer on a generated bundle or lockfile.
 */
export const MAX_HIGHLIGHT_CHARS = 400_000;
export const MAX_HIGHLIGHT_LINES = 12_000;

/** TextMate font-style bit flags (values fixed by @shikijs/vscode-textmate). */
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

/** `var(--shiki-*)` name → semantic kind. Unlisted variables fall back to plain. */
const VARIABLE_KINDS: Record<string, CodeTokenKind> = {
  "--shiki-foreground": "plain",
  "--shiki-token-keyword": "keyword",
  "--shiki-token-control": "control",
  "--shiki-token-type": "type",
  "--shiki-token-tag": "tag",
  "--shiki-token-string": "string",
  "--shiki-token-string-expression": "string-expression",
  "--shiki-token-comment": "comment",
  "--shiki-token-constant": "constant",
  "--shiki-token-number": "number",
  "--shiki-token-function": "function",
  "--shiki-token-punctuation": "punctuation",
  "--shiki-token-variable": "variable",
  "--shiki-token-parameter": "parameter",
  "--shiki-token-link": "link",
};

/** Theme name registered with the core highlighter. */
const THEME_NAME = "css-variables";

/** One `tokenColors` entry of the theme Shiki hands to vscode-textmate. */
type ThemeTokenRule = NonNullable<ThemeRegistration["tokenColors"]>[number];

/**
 * Rules layered on top of Shiki's css-variables theme so the palette can carry
 * the distinctions VS Code's default themes make.
 *
 * The stock theme buckets aggressively: types share the function colour, every
 * identifier is body text, control flow looks like `const`, and operators read
 * as keywords. Dark+ / Light+ are recognisable *because* of those splits, so
 * the rules below re-derive them from the same TextMate scopes VS Code's own
 * theme keys off — the palette stays in defineColor.css, only the scope→kind
 * routing lives here.
 *
 * Appended, not merged: vscode-textmate resolves the longest matching selector
 * first and breaks ties with the later rule, so an entry here overrides a
 * Shiki entry with the same scope but never one that is more specific. That is
 * why the JSON key scope is spelled out in full instead of relying on the
 * shorter `support.type.property-name`.
 */
const VSCODE_TOKEN_RULES: ThemeTokenRule[] = [
  {
    scope: [
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.operator.delete",
      "keyword.other.using",
      "entity.name.operator",
    ],
    settings: { foreground: "var(--shiki-token-control)" },
  },
  /* Operators and key/value separators are body text in VS Code, not keywords. */
  {
    scope: ["keyword.operator", "punctuation.separator.key-value"],
    settings: { foreground: "var(--shiki-foreground)" },
  },
  /* `true` / `null` / `this` stay with the declaration keywords. */
  {
    scope: ["constant.language", "variable.language"],
    settings: { foreground: "var(--shiki-token-keyword)" },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "entity.name.namespace",
      "entity.other.inherited-class",
      "meta.return-type",
      "support.class",
      "support.type",
    ],
    settings: { foreground: "var(--shiki-token-type)" },
  },
  { scope: ["entity.name.tag"], settings: { foreground: "var(--shiki-token-tag)" } },
  {
    scope: [
      "variable",
      "meta.definition.variable.name",
      "meta.object-literal.key",
      "meta.property-name",
      "support.variable",
      "entity.name.variable",
      "entity.other.attribute-name",
      "constant.other.placeholder",
      /* Property-name keys: JSON/CSS/YAML each carry their own leaf scope. */
      "support.type.property-name",
      "support.type.property-name.json",
      "entity.name.tag.yaml",
    ],
    settings: { foreground: "var(--shiki-token-variable)" },
  },
  {
    scope: ["variable.other.constant", "variable.other.enummember"],
    settings: { foreground: "var(--shiki-token-constant)" },
  },
  {
    scope: ["constant.numeric", "keyword.other.unit"],
    settings: { foreground: "var(--shiki-token-number)" },
  },
];

/** In-flight or settled highlighter; created at most once per shell session. */
let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Grammars already handed to the highlighter, so each loads exactly once. */
const loadedLanguages = new Set<CodeLanguage>();

/**
 * Create (or reuse) the shared highlighter.
 *
 * Shiki itself is imported dynamically, not at module scope: the shell mounts
 * long before anyone opens a preview, and a static import would put the whole
 * TextMate engine in the initial bundle for sessions that never show code.
 *
 * @returns The core highlighter with only the css-variables theme registered.
 *   A rejected creation is not cached, so a transient failure can be retried by
 *   the next preview instead of poisoning highlighting for the whole session.
 */
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createCssVariablesTheme, createHighlighterCore }, { createJavaScriptRegexEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
        ]);
      const theme = createCssVariablesTheme({
        name: THEME_NAME,
        variablePrefix: "--shiki-",
        fontStyle: true,
      });
      theme.tokenColors = [
        ...(theme.tokenColors ?? []),
        ...VSCODE_TOKEN_RULES,
      ];
      return createHighlighterCore({
        themes: [theme],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })().catch((error: unknown) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

/**
 * Map one Shiki token's color variable onto a semantic kind.
 * @param color Token color from the css-variables theme, e.g.
 *   "var(--shiki-token-keyword)"; a literal hex or undefined means the theme did
 *   not style this run and it renders as body text.
 */
function kindForColor(color: string | undefined): CodeTokenKind {
  const match = /^var\((--shiki-[a-z-]+)\)$/.exec(color ?? "");
  if (!match) {
    return "plain";
  }
  return VARIABLE_KINDS[match[1]] ?? "plain";
}

/**
 * Convert a Shiki token into the app's render-ready shape.
 * @param token Themed token from `codeToTokens`.
 * @returns Token carrying a semantic kind plus any font-style flags; the flags
 *   are omitted (not false) so React does not diff nine dead props per run.
 */
function toCodeToken(token: ThemedToken): CodeToken {
  const style = token.fontStyle ?? 0;
  return {
    content: token.content,
    kind: kindForColor(token.color),
    offset: token.offset,
    italic: (style & FONT_STYLE_ITALIC) !== 0 || undefined,
    bold: (style & FONT_STYLE_BOLD) !== 0 || undefined,
    underline: (style & FONT_STYLE_UNDERLINE) !== 0 || undefined,
  };
}

/**
 * Whether highlighting should be attempted for this input at all.
 * @param code Source text.
 * @param language Resolved grammar, or null when the file type is unknown.
 * @returns false when there is no grammar or the input exceeds the size guards,
 *   in which case callers must render their existing plain-text fallback.
 */
export function canHighlight(
  code: string,
  language: CodeLanguage | null,
): language is CodeLanguage {
  return (
    language !== null && code.length > 0 && code.length <= MAX_HIGHLIGHT_CHARS
  );
}

/**
 * Tokenize source into per-line semantic tokens.
 * @param code Source text; line splitting follows Shiki's, so index i of the
 *   result is source line i+1 — the same 1-based numbering the gutters use.
 * @param language Grammar to tokenize with.
 * @returns One token array per line, or null when the guards reject the input
 *   or tokenization throws. Null always means "render plain text", never an
 *   error the caller has to surface.
 */
export async function highlightToLines(
  code: string,
  language: CodeLanguage | null,
): Promise<CodeLine[] | null> {
  if (!canHighlight(code, language)) {
    return null;
  }
  try {
    const highlighter = await getHighlighter();
    if (!loadedLanguages.has(language)) {
      await highlighter.loadLanguage(await loadLanguageGrammar(language));
      loadedLanguages.add(language);
    }
    const result = highlighter.codeToTokens(code, {
      lang: language,
      theme: THEME_NAME,
    });
    if (result.tokens.length > MAX_HIGHLIGHT_LINES) {
      return null;
    }
    return result.tokens.map((line) => line.map(toCodeToken));
  } catch {
    // Grammar load / tokenize failures must never take the preview down.
    return null;
  }
}

/**
 * Splice per-line tokens back into one continuous run stream.
 * @param lines Per-line tokens from {@link highlightToLines}.
 * @returns A flat token list with an explicit "\n" run between lines, so a
 *   caller that renders a whole block (a Markdown fence, which has no gutter to
 *   hang lines off) needs no per-line wrapper element. Newline runs get the
 *   offset of the character they stand for, keeping every offset unique.
 */
export function flattenCodeLines(lines: CodeLine[]): CodeToken[] {
  const flat: CodeToken[] = [];
  let cursor = 0;
  lines.forEach((tokens, index) => {
    if (index > 0) {
      flat.push({ content: "\n", kind: "plain", offset: cursor });
      cursor += 1;
    }
    for (const token of tokens) {
      flat.push(token);
    }
    const last = tokens[tokens.length - 1];
    if (last) {
      cursor = last.offset + last.content.length;
    }
  });
  return flat;
}

/**
 * Kind → shortcut class.
 *
 * Written out as literals rather than built with `code-tok-${kind}`: UnoCSS
 * emits only classes it can find by scanning source text, so an interpolated
 * name would compile to nothing and every token would render as body text.
 * "plain" maps to "" on purpose so unstyled runs inherit the surrounding body
 * color instead of pinning a second foreground token.
 */
const KIND_CLASSES: Record<CodeTokenKind, string> = {
  plain: "",
  keyword: "code-tok-keyword",
  control: "code-tok-control",
  type: "code-tok-type",
  tag: "code-tok-tag",
  string: "code-tok-string",
  "string-expression": "code-tok-string-expression",
  comment: "code-tok-comment",
  constant: "code-tok-constant",
  number: "code-tok-number",
  function: "code-tok-function",
  punctuation: "code-tok-punctuation",
  variable: "code-tok-variable",
  parameter: "code-tok-parameter",
  link: "code-tok-link",
};

/**
 * Class list for one token.
 * @param token Token to style.
 * @returns Space-joined `code-tok*` shortcuts (see uno/shortcuts.code.ts).
 */
export function tokenClassName(token: CodeToken): string {
  const classes = ["code-tok"];
  const kindClass = KIND_CLASSES[token.kind];
  if (kindClass !== "") {
    classes.push(kindClass);
  }
  if (token.italic) {
    classes.push("code-tok-italic");
  }
  if (token.bold) {
    classes.push("code-tok-bold");
  }
  if (token.underline) {
    classes.push("code-tok-underline");
  }
  return classes.join(" ");
}
