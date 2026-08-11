/**
 * Session rail / side-nav UnoCSS shortcuts: chrome, project tree, session rows.
 * Kept separate so appShortcuts stays under the 440-line hard cap.
 */

export const sideNavShortcuts: Record<string, string> = {
  /*
   * Desktop: fixed 272px column.
   * ≤900px: off-canvas overlay so main keeps width (tablet + narrow laptop);
   * top-nav hamburger toggles data-open.
   */
  "side-nav":
    "fixed left-0 top-0 z-50 flex flex-col w-sidebar h-full py-2 border-r border-line-subtle bg-sidebar transition-transform duration-normal ease-soft max-[900px]:translate-x-[-100%] max-[900px]:z-100 max-[900px]:shadow-modal max-[900px]:data-[open=true]:translate-x-0",
  "side-nav-backdrop":
    "fixed inset-0 z-90 bg-overlay border-none p-0 m-0 cursor-default max-[900px]:block",
  "side-nav-header":
    "flex items-center justify-between px-4.5 pt-3 pb-2 min-h-11",
  "side-nav-title": "m-0 text-headline font-medium tracking-tight text-fg",
  "side-nav-actions": "flex flex-col gap-2 px-3.5 pb-3 pt-1",
  "btn-new-chat":
    "flex items-center justify-between gap-2 w-full h-10 pl-3 pr-2.5 rounded-9px border-none bg-white-soft text-fg text-nav font-normal text-left transition-colors duration-normal ease-soft hover:bg-white-hover active:bg-white-soft",
  "btn-new-chat-label": "inline-flex items-center gap-2 min-w-0",
  "btn-new-chat-icon":
    "inline-flex w-3.5 justify-center opacity-70 text-15px leading-none",
  "side-nav-kbd":
    "shrink-0 inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-kbd bg-kbd text-fg-muted font-sans text-11px font-normal tracking-normal leading-none",
  "side-nav-kbd-btn":
    "border-none cursor-pointer min-w-7 h-7 hover:(text-fg bg-white-soft) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] rounded-kbd)",
  /* Count badge: Tasks streaming on trigger / menu row */
  "side-nav-nav-badge":
    "shrink-0 inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-pill bg-white-soft text-fg-muted text-10px font-medium tabular-nums",
  /* Workspace menu (user chip → Settings / Tasks / …) opens upward */
  "side-nav-workspace-menu": "relative w-full",
  "side-nav-workspace-menu-list":
    "absolute left-0 right-0 bottom-[calc(100%+6px)] z-80 m-0 p-1.5 list-none min-w-0 rounded-shell border border-line-subtle bg-elevated shadow-popover animate-overlay-in",
  "side-nav-workspace-menu-item":
    "flex w-full items-center justify-between gap-3 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
  "side-nav-workspace-menu-label": "min-w-0 font-medium",
  "side-nav-workspace-menu-hint":
    "shrink-0 text-11px text-fg-muted font-mono",
  "side-nav-workspace-menu-sep":
    "h-px my-1 mx-1 bg-line-subtle border-none",
  "side-nav-search-wrap":
    "flex items-center gap-2 w-full h-8.5 px-2.5 rounded-9px bg-white-faint transition-colors duration-normal ease-soft focus-within:bg-white-soft",
  "side-nav-search-icon":
    "shrink-0 text-fg-muted text-13px leading-none opacity-75",
  "side-nav-search":
    "flex-1 min-w-0 h-full border-none bg-transparent text-fg text-nav p-0 placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
  /* Right inset slightly wider than left so timestamps / count badges
   * don't sit flush against the rail edge.
   * No flex gap: gap leaves a transparent strip between sticky workspace
   * headers and scrolling session rows. */
  "side-nav-scroll":
    "flex-1 overflow-y-auto min-h-0 pl-2.5 pr-3.5 pb-2 flex flex-col",
  "side-nav-empty": "px-2.5 py-4 text-12px text-fg-muted leading-snug",
  /*
   * Project tree (session rail): "PROJECTS" lives outside the scrollport
   * (SessionRailView) so rows never paint under it. Inside the scroll area,
   * each workspace folder name is sticky at top-0 with opaque bg-sidebar so
   * nested sessions scroll underneath cleanly. Folder header is a quiet row
   * (not a selection pill); the selected session is an elevated pill (fill +
   * medium title, no ring), and its folder carries the active marker
   * (project-group-active) so the current project reads without one.
   */
  /* pl/pr match side-nav-scroll; label keeps px-2.5 so “PROJECTS” lines up
   * with folder titles (scroll pad + label pad), same as when it lived inside
   * the scroll area. */
  "project-section-head":
    "flex items-center justify-between gap-2 shrink-0 pl-2.5 pr-3.5 pt-1 pb-1.5",
  "project-section-label":
    "px-2.5 text-10px font-medium tracking-[0.08em] uppercase text-fg-muted leading-none",
  "project-section-count":
    "px-2.5 text-10px text-fg-faint tabular-nums leading-none",
  /* pb owns inter-group spacing (replaces former scroll gap-0.5). */
  "project-group": "flex flex-col gap-px pb-1.5",
  /*
   * Folder holding the selected chat. Idle folders sit at secondary ink, so
   * lifting name → full contrast plus an accent glyph and a stronger tree
   * guide is enough to place the current project at a glance — no fill or
   * accent bar on the header (it must stay quieter than the selected row,
   * and sticky paint has to remain opaque).
   * Parent selectors (2 classes) outrank the single-class base shortcuts, so
   * this wins regardless of the order Uno emits them in.
   */
  "project-group-active":
    "[&_.project-group-name]:text-fg [&_.project-group-folder]:text-primary [&_.project-group-sessions]:before:bg-line-muted",
  "project-group-collapsed": "pb-0.5",
  /*
   * Workspace folder name sticks at the top of side-nav-scroll while that
   * group's sessions move. Rest + hover fills MUST stay OPAQUE (bg-sidebar /
   * bg-sidebar-hover — never white-* translucent tokens): sessions scroll
   * under the sticky header, and a transparent hover would show titles
   * bleeding through the folder name. Square corners (no rounded-*) so sticky
   * paint never leaks text through a radius. Upward box-shadow paints over
   * subpixel bleed at the scrollport top edge. gap-1.5 keeps the count badge
   * clear of the truncated name; pr-1.5 mirrors the row's right inset so
   * 3-digit counts don't hug the rail.
   */
  "project-group-header":
    "sticky top-0 z-10 flex items-center gap-1.5 min-h-8 pr-1.5 bg-sidebar shadow-[0_-8px_0_0_var(--color-bg-sidebar)] transition-colors duration-fast ease-soft hover:bg-sidebar-hover",
  "project-group-main":
    "flex flex-1 items-center gap-1.5 min-w-0 h-8 pl-1 border-none rounded-8px bg-transparent text-left cursor-pointer focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
  /* Rotate −90° when collapsed so the same ChevronDown points right. */
  "project-group-chevron":
    "w-3 h-3 shrink-0 block text-fg-faint transition-[color,transform] duration-fast ease-soft group-hover:text-fg-muted",
  "project-group-chevron-collapsed": "-rotate-90",
  /* Flat folder stack — both glyphs absolute; active/idle crossfade + scale. */
  "project-group-folder":
    "relative shrink-0 inline-block w-3.5 h-3.5 text-fg-secondary",
  "project-group-icon":
    "absolute inset-0 w-3.5 h-3.5 block transition-[opacity,transform] duration-fast ease-soft",
  "project-group-icon-active": "opacity-100 scale-100",
  "project-group-icon-idle": "opacity-0 scale-90 pointer-events-none",
  /* leading-snug (not leading-none): overflow-hidden + line-height:1 clips
   * glyph tops/bottoms; match sess-title so folder labels stay fully readable.
   * Rest sits at secondary ink so the active folder (project-group-active →
   * text-fg) is the only one at full contrast; hover restores it too. */
  "project-group-name":
    "min-w-0 flex-1 pr-0.5 text-nav font-medium text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis leading-snug transition-colors duration-fast ease-soft group-hover:text-fg",
  /* Count badge only — pin belongs on session rows, not the folder. */
  "project-group-count":
    "shrink-0 inline-flex items-center justify-center min-w-4.5 h-4.5 px-1.5 rounded-pill bg-white-soft text-fg-muted text-10px font-medium tabular-nums leading-none",
  /* Nested list: left guide line under the folder glyph. */
  "project-group-sessions":
    "relative flex flex-col gap-px ml-[18px] pl-2 before:(content-[''] absolute left-0 top-1 bottom-1 w-px bg-line-subtle)",
  "project-group-more":
    "w-full pl-2 pr-2 py-1 border-none rounded-7px bg-transparent text-left text-11px text-fg-muted cursor-pointer transition-colors duration-fast ease-soft hover:(text-fg-secondary bg-white-faint) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
  /* Legacy aliases. */
  "time-group": "flex flex-col gap-0.5 pb-3",
  "time-group-label":
    "px-2.5 pt-1.5 pb-2 text-11px font-normal tracking-wide text-fg-muted",
  /*
   * Session rows: title | trailing actions (pin + time-or-remove).
   * Pin and meta share one flex cluster so the pin sits tight against the
   * time/remove slot — not a full grid-gap away. Height uses px (html
   * font-size is 13px; rem h-* collapses). No leading status dot; live /
   * waiting only lift title color; selection is elevated pill + medium title.
   */
  "sess-row":
    "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 w-full h-[32px] pl-2 pr-1.5 rounded-7px cursor-pointer text-fg-secondary transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) data-[dragging=true]:(opacity-45) data-[drag-over=true]:(bg-white-soft shadow-[inset_0_2px_0_0_var(--color-text-primary)])",
  /*
   * Selected chat: elevated fill one step above the rest (surface-highest)
   * + medium title. No border / inset ring — fill + weight alone mark
   * selection so the row stays quiet next to folder chrome. Still no left
   * accent bar / status dot. Drag-over keeps its own inset shadow (class +
   * attribute selector outranks this one).
   */
  "sess-row-active":
    "bg-highest text-fg hover:(bg-highest text-fg) [&_.sess-title]:font-medium",
  "sess-row-process-live": "[&_.sess-title]:text-fg",
  "sess-row-waiting": "[&_.sess-title]:text-fg",
  /*
   * Pinned row: keep the pin solid without fighting `.sess-pin { opacity:0 }`.
   * Parent selector (`.sess-row-pinned .sess-pin`) beats the single-class base
   * rule; a same-element `.sess-pin-active` alone loses when Uno emits the base
   * shortcut after the active one.
   */
  "sess-row-pinned":
    "[&_.sess-title]:text-fg [&_.sess-pin]:(opacity-100 pointer-events-auto text-fg)",
  "sess-title":
    "block min-w-0 max-w-full whitespace-nowrap overflow-hidden text-ellipsis text-nav font-normal tracking-tight leading-snug",
  /* Pin + meta: zero internal gap so icons hug the time digits. */
  "sess-actions": "shrink-0 flex items-center gap-0",
  /*
   * Pin control: hidden at rest, appears on row hover / focus. Stays solid
   * when pinned via `.sess-row-pinned .sess-pin` (see sess-row-pinned) so the
   * base opacity-0 rule cannot win on cascade order. `sess-pin-active` marks
   * the pressed state for a11y / icon fill; visibility is owned by the row.
   * Narrower than a full 28px square so the glyph sits next to meta; height
   * stays 28px for hit target. No hover fill / no outer padding.
   */
  "sess-pin":
    "shrink-0 flex items-center justify-center w-5.5 h-7 p-0 m-0 border-none rounded-6px bg-transparent text-fg-muted cursor-pointer opacity-0 pointer-events-none transition-opacity duration-fast ease-soft group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:text-fg focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)] rounded-6px)",
  "sess-pin-active": "text-fg",
  "sess-pin-icon": "w-3.5 h-3.5 block shrink-0",
  /*
   * One fixed slot holds either the relative time (resting) or the remove
   * control (hover / keyboard focus) — they cross-fade in place, so the two
   * never paint over each other and the title truncation point never moves.
   * Width fits `45s` / `12m` / `37m` at 10px; right edge of digits lines up
   * with sibling rows (same meta width on every row).
   */
  "sess-meta":
    "relative shrink-0 flex items-center justify-end w-[24px] h-7",
  "sess-time":
    "shrink-0 w-full pr-0.5 text-10px leading-none text-fg-muted whitespace-nowrap tabular-nums text-right transition-opacity duration-fast ease-soft group-hover:opacity-0 group-focus-within:opacity-0",
  /*
   * Remove is a narrow icon control, right-aligned inside the meta slot so
   * its hover fill does not paint a full-width bar and its right edge still
   * matches the time digits (`3h` / `37m`). Not `inset-0` — that made the
   * background as wide as the whole time column.
   */
  "sess-remove":
    "absolute right-0 top-0 flex items-center justify-center w-5.5 h-7 p-0 m-0 border-none bg-transparent text-fg-muted rounded-6px opacity-0 pointer-events-none transition-opacity duration-fast ease-soft group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:(text-fg bg-white-soft) focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)])",
  "sess-remove-icon": "w-3.5 h-3.5 block shrink-0",
  "side-nav-footer":
    "mt-auto px-3.5 pt-2.5 pb-1 border-t border-line-subtle flex flex-col gap-2.5",
  "side-nav-quota":
    "grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-2 gap-y-1.5 px-0.5 items-center",
  "side-nav-quota-label": "text-11px text-fg-muted",
  "side-nav-quota-value": "text-11px text-fg-secondary tabular-nums",
  "side-nav-quota-track":
    "col-span-full h-0.75 rounded-pill bg-white-faint overflow-hidden",
  "side-nav-quota-fill":
    "h-full rounded-inherit bg-fg-faint transition-width duration-slow ease-out",
  "side-nav-user":
    "flex items-center gap-2.5 w-full px-2 py-1.5 border-none rounded-8px bg-transparent text-fg-secondary text-left cursor-pointer transition-colors duration-normal ease-soft hover:(bg-white-faint text-fg) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
  /* Open state: elevated chip + solid ⋯ so the menu trigger stays readable. */
  "side-nav-user-open":
    "bg-white-faint text-fg [&_.side-nav-user-action]:(opacity-100 bg-white-soft) [&_.side-nav-user-name]:text-fg",
  "side-nav-avatar":
    "flex items-center justify-center w-5.5 h-5.5 rounded-pill bg-primary text-on-primary text-11px font-semibold shrink-0",
  "side-nav-user-meta": "flex-1 min-w-0 flex flex-col gap-px",
  "side-nav-user-name":
    "text-nav text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-fg",
  "side-nav-user-status": "text-11px text-fg-muted",
  "side-nav-user-action":
    "shrink-0 w-7 h-7 flex items-center justify-center rounded-7px text-fg-muted text-14px opacity-70 transition-all duration-fast ease-soft group-hover:(opacity-100 bg-white-faint)",
};
