/**
 * Agents companion (master–detail inspector) UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const agentsShortcuts: Record<string, string> = {
  "agents-panel":
    "flex flex-col flex-1 min-h-0 outline-none",
  "agents-roster-row":
    "w-full flex flex-col items-stretch gap-0.25 text-left text-12px leading-snug text-fg px-1.5 py-1 rounded-control",
  "agents-roster-row-selected": "bg-white-soft",
  "agents-roster-row-disabled": "text-fg-muted cursor-default",
  /* Dot + title share one line so the 6px status indicator centers on the label. */
  "agents-roster-row-title":
    "min-w-0 flex items-center gap-1.5",
  "agents-roster-row-label":
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  /* pl-3 = 6px dot + 6px gap, so metrics line up under the title text. */
  "agents-roster-row-meta":
    "pl-3 text-11px leading-snug text-fg-muted",
  /* Roster-only: grow so the list is the scroller. Pair with agents-rail. */
  "agents-rail-fill": "flex-1",
  /*
   * Inspect picker: title-only rows, size to the list. Floor 8.5rem so a
   * 4-row fan-out never grows a mid-panel scrollbar on a short window;
   * 17rem / 38% keep leftover height for the transcript (only scroller).
   * Do not use flex-1 — that used to split the pane 50/50 with agents-detail.
   */
  "agents-rail-compact": "shrink-0 max-h-[min(17rem,max(8.5rem,38%))]",
  /*
   * Compact inspect section: no "Subagents" / round chrome, tight inset so
   * four title rows fit under the cap without overflowing.
   */
  "agents-rail-section-compact": "flex flex-col gap-1 px-2.5 py-1.5",
  "agents-detail":
    "flex flex-col flex-1 min-h-0 border-t border-line-subtle",
  /* Meta-only strip — title already lives on the selected roster row. */
  "agents-detail-head":
    "shrink-0 flex flex-col gap-0.5 px-2.5 py-1.5 border-b border-line-subtle",
  "agents-detail-head-meta": "m-0 text-11px text-fg-muted",
  "agents-detail-head-error": "m-0 text-11px text-danger",
  /*
   * Must be a column: `.timeline` is flex-1 min-h-0 overflow-y-auto.
   * Without display:flex the child grows to content height, this wrap
   * clips it (overflow-hidden), and the prompt cannot scroll.
   */
  "agents-transcript-wrap":
    "flex flex-col flex-1 min-h-0 overflow-hidden [&_.timeline]:(min-h-0 text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)])",
  "agents-transcript-fallback":
    "flex flex-col flex-1 min-h-0 gap-2 p-3 overflow-y-auto overscroll-contain",
  "agents-transcript-hint": "m-0 text-12px leading-snug text-fg-muted",
  "agents-transcript-output":
    "text-[length:var(--font-size-body-sm)] leading-snug text-fg whitespace-pre-wrap",
  "agents-transcript-skeleton":
    "h-16 rounded-control bg-skeleton animate-pulse",
  /*
   * Narrow density: hide tool *bodies* only. Title rows stay so a tools-only
   * turn is still a full transcript. Do not hide `.turn-rail`.
   * Lift the canvas turn-rail max-h (280px floor) so the inspector does not
   * grow a second scrollbar in the middle of the 300px drawer.
   * !px/pt/pb/gap override `.timeline` px-container (32–80px) + gap-7.
   */
  "agents-transcript":
    "h-full min-h-0 overscroll-contain !px-3 !pt-3 !pb-3 !gap-4 [&_.tool-content-wrap]:hidden [&_.turn-rail]:(max-h-none overflow-visible)",
  "agents-resize-handle":
    "absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-white-soft",
};
