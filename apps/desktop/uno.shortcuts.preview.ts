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
  "preview-code-text":
    "align-top pl-2.5 pr-3 py-0.25 text-fg whitespace-pre-wrap break-words",
  "preview-diff": "flex flex-col min-h-0",
  "preview-diff-stack": "flex flex-col gap-3 min-h-0 overflow-auto p-0",
  "preview-diff-path":
    "px-3.5 py-1.5 text-11px font-mono text-fg-secondary border-b border-line-subtle break-all",
  "preview-diff-gap":
    "px-3.5 py-1.25 text-11px text-fg-muted text-center bg-[var(--color-diff-collapsed-bg)] border-y border-line-subtle",
  "preview-diff-hunk": "flex flex-col",
  "preview-diff-hunk-head":
    "px-3.5 py-1 font-mono text-10px text-fg-muted bg-white-faint border-b border-line-subtle",
  "preview-diff-row":
    "grid grid-cols-[2.5rem_2.5rem_1rem_1fr] gap-0 font-mono text-11px leading-relaxed",
  "preview-diff-row-add": "bg-diff-add-bg",
  "preview-diff-row-del": "bg-diff-del-bg",
  "preview-diff-oldno":
    "text-right pr-1.5 pl-1 py-0.25 text-[var(--color-diff-gutter)] select-none tabular-nums",
  "preview-diff-newno":
    "text-right pr-1.5 pl-0.5 py-0.25 text-[var(--color-diff-gutter)] select-none tabular-nums border-r border-line-subtle",
  "preview-diff-mark":
    "text-center py-0.25 text-fg-muted select-none",
  "preview-diff-text":
    "pl-1.5 pr-3 py-0.25 text-fg whitespace-pre-wrap break-words",
  "preview-change-list": "flex flex-col min-h-0 overflow-auto",
  "preview-change-summary":
    "sticky top-0 z-1 px-3.5 py-2 text-12px text-fg-secondary bg-surface border-b border-line-subtle flex items-center gap-2",
  "preview-change-file":
    "flex flex-col border-b border-line-subtle last:border-b-0",
  "preview-change-file-head":
    "sticky top-8 z-1 flex items-center justify-between gap-2 px-3.5 py-2 bg-titlebar border-b border-line-subtle",
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
    "flex w-full items-center gap-2 mt-2 px-2.5 py-1.5 rounded-8px border border-line-subtle bg-white-faint text-left text-12px text-fg transition-colors duration-fast ease-soft hover:(bg-white-soft) cursor-pointer",
  "turn-change-summary-label": "min-w-0 flex-1 font-medium",
  "composer-mention-file-btn":
    "inline border-none bg-transparent p-0 m-0 cursor-pointer font-inherit text-inherit",
  /* Hunk review chrome (moved from timeline-only usage) */
  "diff-review":
    "font-mono text-11px border border-line-subtle rounded-8px overflow-hidden bg-white-faint mx-3.5 mb-3",
  "diff-hunk": "border-t border-line-subtle",
  "diff-hunk-accept": "bg-diff-add-bg",
  "diff-hunk-reject": "bg-diff-del-bg",
  "diff-hunk-actions":
    "flex items-center gap-1.5 px-2.5 py-1 border-b border-line-subtle",
  "diff-line": "flex gap-0 px-0",
  "diff-line-add": "bg-diff-add-bg",
  "diff-line-del": "bg-diff-del-bg",
  "diff-gutter":
    "shrink-0 w-5 text-center select-none text-fg-muted",
  "diff-text": "flex-1 whitespace-pre-wrap break-words px-2 py-0.25",
  "diff-review-footer":
    "flex items-center gap-2 px-2.5 py-2 border-t border-line-subtle",
  "mini-diff-summary": "text-fg-muted tabular-nums",
};
