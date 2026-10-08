/**
 * Integrated terminal dock UnoCSS shortcuts (bottom panel under the composer).
 * Colors resolve through defineColor tokens via theme color names; the xterm
 * canvas itself is themed from --color-terminal-* at runtime.
 */

export const terminalShortcuts: Record<string, string> = {
  /* In-flow bottom dock of `.main`; height comes from the widget (drag / prefs). */
  "terminal-dock":
    "relative flex flex-col shrink-0 min-h-0 border-t border-line-subtle bg-timeline",
  /* Closed dock stays mounted (xterm scrollback survives) but takes no space. */
  "terminal-dock-closed": "hidden",
  /* 6px grab strip on the top edge; hairline tint on hover / while dragging. */
  "terminal-resize-handle":
    "absolute top-0 left-0 right-0 z-10 h-1.5 cursor-row-resize bg-transparent transition-colors duration-fast ease-soft hover:bg-line-muted touch-none",
  "terminal-resize-handle-active": "bg-line-strong",
  "terminal-head":
    "flex items-center gap-1 h-9 shrink-0 pl-2 pr-1.5 border-b border-line-subtle",
  /* One tab = trigger + close glyph; close shows on hover / focus / active. */
  "terminal-tab":
    "group relative flex items-center shrink-0 max-w-56 rounded-6px",
  "terminal-tab-label":
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  "terminal-tab-close":
    "flex items-center justify-center w-5 h-5 shrink-0 -ml-1 mr-0.5 border-none rounded-5px bg-transparent text-fg-faint opacity-0 transition-opacity duration-fast ease-soft hover:(text-fg bg-white-faint) focus-visible:(opacity-100 outline-none ring-2 ring-[var(--color-focus-ring)]) group-hover:opacity-100",
  "terminal-tab-close-visible": "opacity-100",
  /* Same chrome family as top-nav icon buttons, one step smaller. */
  "terminal-icon-btn":
    "flex items-center justify-center w-7 h-7 shrink-0 border-none rounded-7px bg-transparent text-fg-muted transition-colors duration-fast ease-soft hover:enabled:(text-fg bg-white-faint) disabled:(opacity-45 cursor-not-allowed) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
  "terminal-body": "relative flex-1 min-h-0",
  /* Each tab panel fills the body; inactive panels stay mounted but hidden. */
  "terminal-pane": "absolute inset-0 pl-2 pr-0.5 pt-1.5 pb-0.5",
  /* Ref-owned xterm mount point; xterm renders everything inside it. */
  "terminal-xterm-host": "w-full h-full overflow-hidden",
  "terminal-empty":
    "flex h-full items-center justify-center px-4 text-12px text-fg-muted",
};
