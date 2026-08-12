/**
 * Document preview typography shortcuts (`doc-*`).
 *
 * Intentionally separate from timeline `md-*`:
 * |                  | md-* (timeline)              | doc-* (preview)              |
 * |------------------|------------------------------|------------------------------|
 * | Input            | agent stream, incomplete MD  | full on-disk file            |
 * | Soft breaks      | whitespace-pre-wrap          | CommonMark fold to spaces    |
 * | Font sizes       | em relative to bubble        | absolute px tokens           |
 * | hr               | hidden                       | visible section rule         |
 * | Math             | normalizeAgentMath + $       | no rewrite + $$ only         |
 * | Block rhythm     | uniform 0.7em                | 0.95em + heading top space   |
 *
 * Colors resolve through defineColor theme names only — no color literals.
 */

export const docShortcuts: Record<string, string> = {
  /* Outer scroll on the drawer edge; reading width is centered inside. */
  "doc-scroll": "flex-1 min-h-0 overflow-auto",
  "doc-root":
    "mx-auto w-full max-w-[var(--doc-max-width)] px-7 py-6 text-doc-body text-fg [overflow-wrap:break-word]",
  /* Sole block rhythm owner: flex gap; children stay margin-free. */
  "doc-flow":
    "min-w-0 w-full flex flex-col items-stretch gap-[0.95em] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "doc-p": "m-0",
  /* Headings buy top air only; bottom spacing comes from flex gap. */
  "doc-h": "mx-0 mb-0 font-semibold text-fg tracking-tight scroll-mt-3",
  "doc-h1": "text-doc-h1 mt-0",
  "doc-h2": "text-doc-h2 mt-[1.5em]",
  "doc-h3": "text-doc-h3 mt-[1.1em]",
  "doc-h4": "text-doc-body mt-[0.9em] text-fg-secondary",
  "doc-list":
    "m-0 pl-[1.5em] [&>li]:my-[0.35em] [&>li]:marker:text-fg-muted [&_ul]:mt-[0.35em] [&_ol]:mt-[0.35em]",
  "doc-list-ordered": "list-decimal",
  "doc-inline-code":
    "font-mono text-[0.92em] px-[0.4em] py-[0.12em] rounded-1.5 bg-white-chip text-fg",
  /* Block chrome on <pre>; inner <code> is highlighted by MarkdownCodeWidget. */
  "doc-pre":
    "m-0 px-3.5 py-3 overflow-x-auto rounded-shell bg-white-code font-mono text-doc-code text-fg [&>code]:(font-inherit whitespace-pre)",
  "doc-pre-wrap": "relative group",
  "doc-pre-copy":
    "absolute right-1.5 top-1.5 btn-ghost h-6 px-1.5 text-11px opacity-0 transition-opacity duration-fast ease-soft group-hover:opacity-100 focus-visible:opacity-100",
  "doc-link":
    "text-fg underline underline-offset-2 decoration-line-strong transition-colors duration-fast ease-soft hover:decoration-fg",
  /* Workspace-relative jumps: dotted underline vs solid external links. */
  "doc-link-internal": "decoration-dotted",
  "doc-blockquote":
    "m-0 pl-[0.95em] border-l-2 border-line-strong text-fg-secondary",
  /* Visible section rule (opposite of md-hr which is hidden). */
  "doc-hr": "mx-0 my-[1.6em] h-0 border-0 border-t border-line-subtle",
  "doc-del": "text-fg-muted line-through",
  "doc-img": "m-0 max-w-full h-auto rounded-soft",
  /* Relative images cannot load in the webview — degrade to a filename chip. */
  "doc-img-missing":
    "inline-flex items-center gap-1 px-2 py-1 rounded-soft bg-white-faint font-mono text-11px text-fg-muted",
  "doc-table-wrap":
    "w-full max-w-full overflow-x-auto rounded-soft border border-line-subtle",
  "doc-table": "w-full border-collapse text-[0.94em] leading-snug",
  "doc-thead": "bg-white-soft border-b border-line-subtle",
  "doc-tr": "border-b border-line-subtle last:border-b-0",
  "doc-th": "px-3 py-2 text-left font-semibold text-fg align-top",
  "doc-td": "px-3 py-2 text-fg align-top",
};
