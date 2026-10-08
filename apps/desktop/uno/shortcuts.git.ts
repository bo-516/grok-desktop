/**
 * Git chrome UnoCSS shortcuts: top-nav branch chip, change-panel action bar,
 * status badges, turn attribution chips, commit / PR dialog parts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const gitShortcuts: Record<string, string> = {
  /* Top-nav chip — same pill family as top-nav-sync, clickable. */
  "git-chip":
    "inline-flex items-center gap-1.25 h-6 px-2.25 min-w-0 max-w-[220px] shrink rounded-pill border-none bg-white-faint text-fg-secondary text-11px leading-none whitespace-nowrap cursor-pointer transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)]) max-[520px]:hidden",
  "git-chip-branch": "min-w-0 truncate font-mono tracking-tight",
  "git-chip-dirty":
    "shrink-0 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-pill bg-white-soft text-10px text-fg tabular-nums",

  /* Change-panel action bar (scrolls away; the summary strip stays sticky). */
  "git-action-bar":
    "flex flex-col gap-2 px-3.5 py-2.5 border-b border-line-subtle bg-surface",
  "git-action-row": "flex flex-wrap items-center gap-1.5 min-w-0",
  "git-branch-line":
    "flex flex-1 items-center gap-1.5 min-w-0 text-12px text-fg-secondary font-mono",
  "git-notice":
    "m-0 text-11px leading-snug text-fg-muted whitespace-pre-wrap break-words",
  "git-notice-row": "flex items-start gap-2 text-fg-secondary",
  "git-notice-error": "text-danger max-h-[160px] overflow-auto",

  /* Segmented scope toggle + turn filter pill. */
  "git-scope-toggle":
    "inline-flex items-center gap-0.5 p-0.5 rounded-control border border-line-subtle",
  "git-scope-btn":
    "h-[22px] px-2 rounded-6px border-none bg-transparent text-11px text-fg-muted cursor-pointer transition-colors duration-fast hover:text-fg focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
  "git-scope-btn-on": "bg-white-soft text-fg",

  /* File heads: status letter + turn chips. */
  "git-status-badge":
    "shrink-0 inline-block w-3.5 text-center font-mono text-10px font-semibold text-fg-muted",
  "git-status-add": "text-diff-add",
  "git-status-del": "text-diff-del",
  "git-status-mod": "text-warning",
  "git-status-move": "text-accent",
  "git-status-conflict": "text-danger",
  "git-turn-chip":
    "shrink-0 rounded-pill bg-white-soft px-1.5 py-px text-10px leading-tight text-fg-muted font-mono",
  "git-file-note":
    "flex flex-wrap items-center gap-2 px-3.5 py-3 text-12px text-fg-muted",

  /* Commit / PR dialogs. */
  "git-field-label": "text-11px font-medium text-fg-secondary",
  "git-commit-files":
    "max-h-[220px] overflow-auto flex flex-col gap-px rounded-control border border-line-subtle p-1",
  "git-commit-file":
    "flex items-center gap-2 min-w-0 px-1.5 py-1 rounded-6px hover:bg-white-faint",
  "git-commit-file-path": "min-w-0 truncate font-mono text-11px text-fg",
  "git-dialog-error":
    "m-0 max-h-[160px] overflow-auto rounded-control bg-danger-muted px-2.5 py-2 font-mono text-11px leading-snug text-danger whitespace-pre-wrap break-words",
  "git-pr-result":
    "flex flex-col gap-1 rounded-control border border-line-subtle bg-white-faint px-2.5 py-2 text-12px text-fg-secondary",
  "git-pr-link":
    "p-0 border-none bg-transparent text-left text-12px text-accent underline-offset-2 hover:underline break-all cursor-pointer",
};
