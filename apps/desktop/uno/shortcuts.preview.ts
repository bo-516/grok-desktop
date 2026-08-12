/**
 * Preview drawer + edit-summary + structured-diff UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const previewShortcuts: Record<string, string> = {
  /*
   * Do not add a "preview-drawer" position utility here: the widget shares
   * context-drawer (fixed top-0/bottom-0). A second position class would
   * override fixed and leave the closed wider rail partially on-screen.
   * Resize handle is absolute against that fixed containing block.
   */
  "preview-resize-handle":
    "absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-white-soft",
  "preview-head":
    "flex items-start justify-between gap-2 h-auto min-h-topnav px-3.5 py-2.5 shrink-0 border-b border-line-subtle bg-titlebar",
  "preview-head-actions": "shrink-0 flex items-center gap-0.5",
  /* File-preview toolbar cluster (mode toggle + copy) left of the close control. */
  "preview-head-toolbar": "shrink-0 flex items-center gap-1",
  "preview-mode-toggle":
    "flex items-center gap-0.5 p-0.5 rounded-8px bg-white-faint",
  "preview-mode-btn": "btn-ghost h-6 px-2 text-11px",
  "preview-mode-btn-active": "bg-high text-fg",
  "preview-head-text": "min-w-0 flex-1 flex flex-col gap-0.5",
  "preview-title":
    "m-0 text-13px font-medium tracking-tight text-fg text-left overflow-hidden text-ellipsis whitespace-nowrap",
  /* Path variant: flex row so path-label-dir absorbs the truncation and the
   * file name stays readable at any drawer width. select-none keeps the
   * double-click copy gesture from leaving a stray word highlighted (the
   * heading is not a button, so the browser would select "desktop" & co). */
  "preview-title-row": "flex items-baseline gap-2 select-none",
  "preview-subtitle": "m-0 text-11px text-fg-muted",
  "preview-counts": "m-0 flex items-center gap-2 text-11px tabular-nums",
  "preview-count-add": "text-diff-add tabular-nums",
  "preview-count-del": "text-diff-del tabular-nums",
  "preview-body": "flex flex-col min-h-0 overflow-hidden",
  "preview-empty":
    "p-4 text-12px leading-snug text-fg-muted",
  "preview-error":
    "p-4 text-12px leading-snug text-danger",
  "preview-banner":
    "shrink-0 px-3.5 py-2 text-11px leading-snug text-fg-secondary bg-white-faint border-b border-line-subtle",
  "preview-banner-warn":
    "text-fg-secondary bg-white-soft",
  "preview-code": "flex flex-col flex-1 min-h-0",
  "preview-code-scroll": "flex-1 min-h-0 overflow-auto",
  "preview-code-table": "w-full border-collapse font-mono text-11px leading-relaxed",
  "preview-code-row": "",
  "preview-code-row-focus": "bg-white-soft",
  "preview-gutter":
    "align-top text-right pr-2 pl-2 py-0.25 text-fg-muted select-none w-10 border-r border-line-subtle",
  "preview-code-text": "align-top pl-2.5 pr-3 py-0.25 text-fg code-wrap",
  /* Scroll lives on the inner region so path/banner stay put; body grows.
   * Nowrap horizontal scroll is ONLY on this container (not per-line text) so
   * all rows share one scroll position and stay aligned. */
  "preview-diff": "flex flex-col min-h-0 flex-1",
  "preview-diff-scroll": "flex-1 min-h-0 overflow-auto",
  "preview-diff-scroll-nowrap": "overflow-x-auto",
  "preview-diff-path":
    "px-3.5 py-1.5 text-11px font-mono text-fg-secondary border-b border-line-subtle break-all",
  /*
   * Floating ⋯ control — no full-width toolbar band (narrow drawer height is
   * precious). Sits top-right of the scroll area; menu opens below it.
   */
  "preview-diff-menu-anchor":
    "absolute right-2 top-1.5 z-3",
  "preview-diff-menu":
    "absolute right-0 top-full mt-1 z-5 min-w-44 flex flex-col gap-0.5 p-1 rounded-8px border border-line-subtle bg-elevated shadow-md",
  "preview-diff-menu-item":
    "btn-ghost text-left w-full justify-start px-2 py-1.5 text-12px",
  /*
   * Single-column line numbers by default (3.25rem fits 5 digits + padding).
   * Dual mode only overrides grid-cols — do not duplicate the whole shortcut.
   * pr on text keeps Accept/Reject from covering the last glyphs.
   * Body text ~12px (Claude-adjacent; pairs with default wrap).
   */
  "preview-diff-row":
    "grid grid-cols-[3.25rem_1.25rem_1fr] gap-0 font-mono text-12px leading-relaxed relative group",
  "preview-diff-row-dual": "grid-cols-[2.75rem_2.75rem_1.25rem_1fr]",
  "preview-diff-row-add": "bg-diff-add-bg",
  "preview-diff-row-del": "bg-diff-del-bg",
  "preview-diff-row-focus": "bg-[var(--color-diff-row-focus)]",
  /* Whole-run decision wash (all rows of a change run, not just the first). */
  "preview-diff-row-accepted": "outline outline-1 outline-diff-add -outline-offset-1",
  "preview-diff-row-rejected": "outline outline-1 outline-diff-del -outline-offset-1 opacity-70",
  "preview-diff-no":
    "text-right pr-2 py-0.25 select-none tabular-nums text-[var(--color-diff-gutter)]",
  "preview-diff-no-add": "bg-diff-add-num text-diff-add",
  "preview-diff-no-del": "bg-diff-del-num text-diff-del",
  "preview-diff-oldno":
    "text-right pr-1.5 pl-1 py-0.25 text-[var(--color-diff-gutter)] select-none tabular-nums",
  "preview-diff-newno":
    "text-right pr-1.5 pl-0.5 py-0.25 text-[var(--color-diff-gutter)] select-none tabular-nums",
  "preview-diff-mark": "text-center py-0.25 select-none",
  "preview-diff-mark-add": "text-diff-add",
  "preview-diff-mark-del": "text-diff-del",
  "preview-diff-text": "pl-1.5 pr-3 py-0.25 text-fg min-w-0",
  "preview-diff-text-wrap": "code-wrap",
  /* min-w-max keeps nowrap rows as wide as content; scroll is on parent. */
  "preview-diff-text-nowrap": "whitespace-pre min-w-max",
  "preview-diff-text-review": "pr-28",
  "diff-emph-add": "bg-diff-add-emph rounded-2px",
  "diff-emph-del": "bg-diff-del-emph rounded-2px",
  /* Fold band: left-aligned, no double borders; hover only on controls. */
  "preview-diff-gap":
    "flex items-center gap-1 px-2 py-1 text-11px text-[var(--color-diff-gap-fg)] bg-diff-gap border-y-0",
  "preview-diff-gap-btn":
    "shrink-0 flex items-center justify-center w-6 h-6 rounded-4px border-none bg-transparent text-[var(--color-diff-gap-fg)] cursor-pointer transition-colors duration-fast ease-soft hover:bg-diff-gap-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]",
  "preview-diff-gap-label":
    "flex-1 min-w-0 text-left border-none bg-transparent cursor-pointer text-inherit px-1 py-0.5 rounded-4px hover:text-fg-secondary hover:bg-diff-gap-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]",
  /* Run-level accept/reject: top-right of first run row; clear pressed state. */
  "preview-diff-run-actions":
    "absolute right-1 top-0.5 flex items-center gap-0.5 z-1",
  "preview-diff-run-btn":
    "btn-ghost text-11px px-1.5 py-0.5 h-auto min-h-0",
  "preview-diff-run-btn-active-accept":
    "text-diff-add bg-diff-add-bg",
  "preview-diff-run-btn-active-reject":
    "text-diff-del bg-diff-del-bg",
  "preview-diff-hunk": "flex flex-col",
  "preview-change-list": "flex flex-col min-h-0 overflow-auto",
  /* Sticky heights shared so file heads sit under the summary strip. */
  "preview-change-summary":
    "sticky top-0 z-2 h-[var(--preview-summary-h,2rem)] px-3.5 py-2 text-12px text-fg-secondary bg-surface border-b border-line-subtle flex items-center gap-2",
  "preview-change-file":
    "flex flex-col border-b border-line-subtle last:border-b-0",
  "preview-change-file-head":
    "sticky top-[var(--preview-summary-h,2rem)] z-1 flex items-center justify-between gap-2 px-3.5 py-2 bg-[var(--color-diff-file-head-bg)] border-b border-line-subtle cursor-pointer border-none w-full text-left hover:bg-white-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]",
  "preview-change-file-path":
    "min-w-0 flex-1 font-mono text-11px text-fg overflow-hidden text-ellipsis whitespace-nowrap",
  "preview-change-file-meta":
    "shrink-0 text-11px text-fg-muted tabular-nums flex items-center gap-1",
  /* Timeline compact edit summary (D3) */
  "edit-summary-row":
    "flex w-full items-center gap-2 mt-1.5 px-2.5 py-1.5 rounded-8px border-none bg-high text-left text-11px text-fg transition-colors duration-fast ease-soft hover:(bg-highest text-fg) cursor-pointer",
  "edit-summary-icon": "shrink-0 text-fg-muted",
  /* Wrapper only: truncation lives on path-label-dir so the file name survives. */
  "edit-summary-path": "min-w-0 flex-1 font-mono overflow-hidden",
  "edit-summary-counts":
    "shrink-0 tabular-nums text-fg-secondary whitespace-nowrap",
  "edit-summary-chevron": "shrink-0 text-fg-muted",
  "turn-change-summary":
    "flex w-full items-center gap-2 mt-2 px-2.5 py-2.5 rounded-8px border border-line-subtle bg-white-faint text-left text-12px text-fg transition-colors duration-fast ease-soft hover:(bg-white-soft) cursor-pointer",
  "turn-change-summary-label": "min-w-0 flex-1 font-medium",
  "composer-mention-file-btn":
    "inline border-none bg-transparent p-0 m-0 cursor-pointer font-inherit text-inherit",
  /* Review shell chrome (decisions + Apply; rows paint in PreviewDiffView) */
  "diff-review":
    "flex flex-col min-h-0 flex-1 overflow-hidden",
  "diff-review-footer":
    "shrink-0 flex items-center gap-2 px-3.5 py-2 border-t border-line-subtle bg-white-faint",
  "mini-diff-summary": "text-fg-muted tabular-nums",
};
