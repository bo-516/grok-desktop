/**
 * Review-loop UnoCSS shortcuts: diff line-comment gutter / composer / cards,
 * the review tray in the git change list, and the turn "Restore" trigger and
 * dialog parts. Colors resolve through defineColor tokens via theme names.
 */

export const reviewShortcuts: Record<string, string> = {
  /* Gutter "+" on a diff row: hidden until the row (.group) is hovered. */
  "diff-comment-add":
    "absolute left-0.5 top-[3px] z-2 inline-flex items-center justify-center size-[15px] p-0 rounded-4px border-none bg-primary text-on-primary cursor-pointer opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:(opacity-100 outline-none ring-2 ring-line-focus) [&_svg]:size-[11px]",
  /* Selected-range wash over the whole row (no layout impact). */
  "diff-comment-wash": "absolute inset-0 pointer-events-none bg-accent-muted",
  /* Slot under a row: stays at the left edge when nowrap rows scroll. */
  "diff-comment-slot":
    "sticky left-0 flex flex-col gap-1.5 w-full max-w-[640px] px-3 py-2 font-sans",
  "diff-comment-card":
    "flex flex-col gap-1 rounded-control border border-line-subtle bg-elevated px-2.5 py-2 text-12px text-fg",
  "diff-comment-card-head":
    "flex items-center gap-2 min-w-0 font-mono text-11px text-fg-muted",
  "diff-comment-card-body":
    "m-0 whitespace-pre-wrap break-words leading-snug",
  "diff-comment-composer":
    "flex flex-col gap-2 rounded-control border border-line-focus bg-elevated px-2.5 py-2",

  /* Review tray pinned to the bottom of the change list. */
  "review-tray":
    "sticky bottom-0 z-3 flex flex-col gap-2 border-t border-line-subtle bg-surface px-3.5 py-2.5",
  "review-tray-list": "m-0 p-0 list-none flex flex-col gap-0.5 max-h-[160px] overflow-auto",
  "review-tray-item": "flex items-center gap-2 min-w-0 text-12px",
  "review-tray-loc":
    "shrink-0 max-w-[45%] truncate font-mono text-11px text-fg-secondary",
  "review-tray-body": "min-w-0 flex-1 truncate text-fg",
  "review-tray-actions": "flex items-center justify-between gap-2",
  "review-tray-notice": "min-w-0 truncate text-11px text-fg-muted",

  /* Turn "Restore": beside the turn change summary (which carries mt-2). */
  "turn-change-row": "flex items-stretch gap-1.5",
  "turn-rewind-trigger-wrap": "mt-2 flex",
  "turn-rewind-trigger": "!h-auto self-stretch rounded-8px text-fg-secondary",
  "turn-rewind-files":
    "m-0 p-1 list-none max-h-[220px] overflow-auto flex flex-col gap-px rounded-control border border-line-subtle",
  "turn-rewind-file":
    "flex items-center gap-2 min-w-0 px-1.5 py-1 rounded-6px font-mono text-11px text-fg hover:bg-white-faint",
  "turn-rewind-file-note": "shrink-0 font-sans text-10px text-warning",
  "turn-rewind-note": "m-0 text-11px leading-snug text-fg-muted",
};
