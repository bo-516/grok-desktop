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
  /* min-h-topnav is a custom rule (theme.height does not feed min-h-*). */
  "preview-head":
    "flex items-start justify-between gap-2 h-auto min-h-topnav px-3.5 py-2.5 shrink-0 border-b border-line-subtle bg-titlebar",
  "preview-head-actions": "shrink-0 flex items-center gap-0.5",
  /* File-preview toolbar cluster (mode toggle + copy) left of the close control. */
  "preview-head-toolbar": "shrink-0 flex items-center gap-1",
  "preview-mode-toggle":
    "flex items-center gap-0.5 p-0.5 rounded-8px bg-white-faint",
  /* 24px row matches preview-copy-btn / context-drawer-close — rem h-6 +
   * btn-ghost padding used to sit off the icon-button baseline. */
  "preview-mode-btn":
    "inline-flex items-center justify-center box-border h-24px px-2 rounded-control border-none bg-transparent text-11px leading-none text-fg-secondary transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) disabled:(opacity-45 cursor-not-allowed)",
  "preview-mode-btn-active": "bg-high text-fg",
  /*
   * Own chrome (not btn-ghost): ghost rem padding wins the cascade and
   * crushes the 16px lucide mark, so the copy face reads as an empty box
   * with the check + label sitting beside it.
   */
  "preview-copy-btn":
    "shrink-0 inline-flex items-center justify-center gap-1 box-border h-24px min-w-24px px-6px py-0 rounded-control border-none bg-transparent text-11px leading-none whitespace-nowrap text-fg-secondary transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) [&_svg]:(block shrink-0)",
  /*
   * Path double-click confirmation. Own chrome — do not stack preview-copy-btn:
   * that face is bg-transparent and would let the path bleed through the chip.
   * bg-highest is an opaque surface (never white-* / titlebar mixes). fixed +
   * body portal because the rail uses translate and the title clips overflow.
   * left/top come from React style (clientX / clientY + offset).
   */
  "preview-copy-flash":
    "fixed z-80 pointer-events-none translate-x-center inline-flex items-center justify-center gap-1 box-border h-24px min-w-24px px-6px py-0 rounded-control border border-line-subtle bg-highest text-11px leading-none whitespace-nowrap text-fg-secondary shadow-popover [&_svg]:(block shrink-0)",
  "preview-head-text": "min-w-0 flex-1 flex flex-col gap-0.5",
  /*
   * Title must wrap: nowrap + ellipsis hid ComposerWidget.tsx (and any
   * long file name) behind the toolbar. overflow-wrap anywhere so a
   * single long segment still breaks instead of forcing a drawer
   * scrollbar. PathLabelView wrap=true owns dir/base line breaks.
   */
  "preview-title":
    "m-0 min-w-0 w-full max-w-full text-13px font-medium tracking-tight text-fg text-left [overflow-wrap:anywhere]",
  /* select-none keeps the double-click copy gesture from leaving a stray
   * word highlighted (the heading is not a button). */
  "preview-title-row": "flex items-start select-none",
  "preview-subtitle": "m-0 text-11px text-fg-muted",
  "preview-counts": "m-0 flex items-center gap-2 text-11px tabular-nums",
  "preview-count-add": "text-diff-add tabular-nums",
  "preview-count-del": "text-diff-del tabular-nums",
  "preview-body": "flex flex-col min-h-0 overflow-hidden",
  /*
   * Stale-while-refresh stack: keep the last file mounted and frost it
   * while a later disk read is in flight. Veil is always in the tree so
   * opacity can fade; pointer-events-none so the old body still scrolls.
   */
  "preview-file-stack": "relative flex flex-col flex-1 min-h-0",
  "preview-file-stack-body": "flex flex-col flex-1 min-h-0",
  "preview-file-stack-body-refreshing": "blur-2px",
  "preview-refresh-veil":
    "absolute inset-0 z-2 pointer-events-none bg-white-soft backdrop-blur-4px opacity-0 transition-opacity duration-fast ease-soft",
  "preview-refresh-veil-on": "opacity-100",
  "preview-empty":
    "p-4 text-12px leading-snug text-fg-muted",
  "preview-error":
    "p-4 text-12px leading-snug text-danger",
  "preview-banner":
    "shrink-0 px-3.5 py-2 text-11px leading-snug text-fg-secondary bg-white-faint border-b border-line-subtle",
  "preview-banner-warn":
    "text-fg-secondary bg-white-soft",
  "preview-code": "flex flex-col flex-1 min-h-0",
  /*
   * File preview always wraps (no wrap toggle). Hide X overflow so a
   * leftover 1px table min-content cannot paint a horizontal bar in
   * the middle of a squeezed transcript + drawer layout.
   */
  "preview-code-scroll": "flex-1 min-h-0 overflow-y-auto overflow-x-hidden",
  /*
   * table-fixed is the load-bearing bit: auto layout sizes columns to
   * the longest unbreakable token *before* wrap can kick in, which is
   * why code-wrap alone still scrolled sideways.
   */
  "preview-code-table":
    "w-full table-fixed border-collapse font-mono text-11px leading-relaxed",
  "preview-code-row": "",
  "preview-code-row-focus": "bg-white-soft",
  "preview-gutter":
    "align-top text-right pr-2 pl-2 py-0.25 text-fg-muted select-none w-10 border-r border-line-subtle",
  "preview-code-text": "align-top pl-2.5 pr-3 py-0.25 text-fg min-w-0 code-wrap",
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
    "grid grid-cols-[3.25rem_1.25rem_1fr] gap-0 font-mono text-12px leading-relaxed relative",
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
  /*
   * Height is content-sized (not a locked 2rem). Counts stay nowrap.
   * Actions grow into leftover space so @container sees that width.
   * basis-28 + min-w-28 = four-icon row: wrap only when even icons
   * cannot sit on the counts line (flex-1's 0% basis would overflow
   * instead). @[22rem] on children swaps icons → labels. 22rem ≈ the
   * four labeled buttons including "✓ " prefixes. --preview-summary-h
   * is measured onto the list so sticky file heads sit under the strip.
   */
  "preview-change-summary":
    "sticky top-0 z-2 px-3.5 py-2 text-12px text-fg-secondary bg-surface border-b border-line-subtle flex flex-wrap items-center gap-x-2 gap-y-1",
  /* Counts + "Edited N files" must not wrap under the pref buttons. */
  "preview-change-summary-label":
    "shrink-0 whitespace-nowrap flex items-center gap-2",
  "preview-change-summary-actions":
    "@container ml-auto grow shrink basis-28 min-w-28 flex flex-nowrap items-center justify-end gap-0.5",
  /*
   * Own chrome (not btn-ghost): rem padding would un-center the 14px
   * lucide mark in the 24px icon face. @[22rem] restores text padding.
   */
  "preview-change-summary-action":
    "inline-flex items-center justify-center box-border h-24px min-w-24px px-6px py-0 rounded-control border-none bg-transparent text-11px leading-none whitespace-nowrap text-fg-secondary transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) [&_svg]:(block shrink-0) @[22rem]:(min-w-0 px-2.5)",
  "preview-change-summary-action-on": "bg-white-soft text-fg",
  "preview-change-summary-action-label": "hidden @[22rem]:inline",
  "preview-change-summary-action-icon": "inline-flex @[22rem]:hidden",
  "preview-change-file":
    "flex flex-col shrink-0 border-b border-line-subtle last:border-b-0",
  /*
   * Opaque rest + hover (diff-file-head-* tokens). Never white-faint: that
   * mix is transparent and lets the alignment banner show through the path.
   */
  "preview-change-file-head":
    "sticky top-[var(--preview-summary-h,2.5rem)] z-1 flex items-center justify-between gap-2 px-3.5 py-2 bg-[var(--color-diff-file-head-bg)] border-b border-line-subtle cursor-pointer border-none w-full text-left hover:bg-[var(--color-diff-file-head-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]",
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
