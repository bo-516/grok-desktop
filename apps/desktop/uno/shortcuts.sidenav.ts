/**
 * Session rail / side-nav UnoCSS shortcuts: chrome, project tree, session rows.
 * Kept separate so appShortcuts stays under the 440-line hard cap.
 * Shortcut values must be string literals — jiti evals this file as the
 * Uno config graph, and a free identifier throws ReferenceError, after
 * which the recovery loader keeps the last good (stale) CSS.
 */

export const sideNavShortcuts: Record<string, string> = {
  /*
   * Desktop: fixed 272px column when docked.
   * Off-canvas (`.side-nav-offcanvas`) when the shell cannot keep the main
   * column at `--main-column-min-width` — hamburger toggles data-open.
   * Both slide states are plain rules from uno.config (translate-x-full-left /
   * translate-x-none). presetUno's own `translate-x-[-100%]` / `translate-x-0`
   * compose through --un-translate-* vars that only its preflight defines, and
   * preflight is off here — the drawer computed `transform:none` and sat fully
   * on screen at every width, with the hamburger moving nothing.
   * data-[open=true] beats the off-canvas closed state on specificity.
   */
  "side-nav":
    "fixed left-0 top-0 z-50 flex flex-col w-sidebar h-full py-2 border-r border-line-subtle bg-sidebar transition-transform duration-normal ease-soft",
  "side-nav-offcanvas":
    "translate-x-full-left z-100 shadow-modal data-[open=true]:translate-x-none",
  "side-nav-backdrop":
    "fixed inset-0 z-90 bg-overlay border-none p-0 m-0 cursor-default",
  "side-nav-header":
    "flex items-center justify-between gap-2 pl-4.5 pr-3.5 pt-3 pb-2 min-h-11",
  "side-nav-title": "m-0 text-headline font-medium tracking-tight text-fg",
  /*
   * Always-visible hide control at the right of "Grok". Same 30px ghost
   * target as top-nav-rail-btn so docked collapse and overlay close match.
   * pr-3.5 on the header lines the glyph up with New chat / search.
   */
  "side-nav-collapse-btn":
    "flex items-center justify-center w-7.5 h-7.5 shrink-0 border-none rounded-8px bg-transparent text-fg-muted cursor-pointer transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
  "side-nav-collapse-icon": "block shrink-0",
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
  /* Count badge: cross-session streaming on trigger / Overview menu row.
   * Px box (html is 13px; rem h-4.5 collapses to ~15px and the digit sits
   * high). Line-height matches height so "1" / "18" sit on the optical center. */
  "side-nav-nav-badge":
    "shrink-0 inline-flex items-center justify-center box-border min-w-[18px] h-[18px] px-[4px] rounded-pill bg-white-soft text-fg-muted text-[10px] font-medium tabular-nums leading-[18px]",
  /*
   * Workspace menu (user chip → Settings / Overview / …) opens upward over the
   * footer quota. z-10 keeps the whole chip+popover above the density track;
   * overflow-hidden clips item paint to the shell radius.
   */
  "side-nav-workspace-menu": "relative z-10 w-full",
  "side-nav-workspace-menu-list":
    "absolute left-0 right-0 bottom-[calc(100%+6px)] z-80 m-0 p-1.5 list-none min-w-0 overflow-hidden rounded-shell border border-line-subtle bg-elevated shadow-popover animate-overlay-in",
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
   * Folder holding the selected chat. All folder names sit at full primary
   * ink; active lifts weight to medium plus an accent glyph and a stronger
   * tree guide — no fill or accent bar on the header (it must stay quieter
   * than the selected row, and sticky paint has to remain opaque).
   * Parent selectors (2 classes) outrank the single-class base shortcuts, so
   * this wins regardless of the order Uno emits them in.
   */
  "project-group-active":
    "[&_.project-group-name]:font-medium [&_.project-group-folder]:text-primary [&_.project-group-sessions]:before:bg-line-muted",
  "project-group-collapsed": "pb-0.5",
  /*
   * Workspace folder name sticks at the top of side-nav-scroll while that
   * group's sessions move. Rest + hover fills MUST stay OPAQUE (bg-sidebar /
   * bg-sidebar-hover — never white-* translucent tokens): sessions scroll
   * under the sticky header, and a transparent hover would show titles
   * bleeding through the folder name. The element's own box stays SQUARE (no
   * rounded-* here) because that opaque box is the mask: a radius on it would
   * let a row scrolling underneath show through the corner notches. The hover
   * fill instead rides a `::before` overlay carrying rounded-8px (same radius
   * as sess-row / project-group-main). z-[-1] keeps it above the header's own
   * background but under the label — the header is a stacking context (sticky
   * + z-10), so the negative layer cannot escape behind bg-sidebar.
   * Upward box-shadow paints over
   * subpixel bleed at the scrollport top edge — keep it at 1px, never taller
   * than the gap between groups (a collapsed group is only pb-0.5 ≈ 1.6px).
   * The band is opaque bg-sidebar drawn by the NEXT sticky header, and equal
   * z-10 means it paints on top of the row above: an 8px band shaved ~6px off
   * the bottom of a collapsed folder row, so its hover fill lost its lower
   * edge and the centered label read as sitting low. gap-1.5 keeps the badge
   * clear of the truncated name; pr-1.5 mirrors the row's right inset so
   * 3-digit counts don't hug the rail.
   * Height is px (html font-size is 13px; rem `min-h-8` / `h-8` collapse to
   * 26px and clip Inter descenders on names like "grok-desktop"). Matches
   * the 36px session pill so folder + chat rows share one cadence.
   */
  "project-group-header":
    "sticky top-0 z-10 flex items-center gap-1.5 min-h-[36px] pr-1.5 bg-sidebar shadow-[0_-1px_0_0_var(--color-bg-sidebar)] before:(content-[''] absolute inset-0 z-[-1] rounded-8px bg-transparent pointer-events-none transition-colors duration-fast ease-soft) hover:before:bg-sidebar-hover",
  "project-group-main":
    "flex flex-1 items-center gap-1.5 min-w-0 h-[36px] pl-1 border-none rounded-8px bg-transparent text-left cursor-pointer focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
  /* Rotate −90° when collapsed so the same ChevronDown points right. */
  "project-group-chevron":
    "w-3 h-3 shrink-0 block text-fg-faint transition-[color,transform] duration-fast ease-soft group-hover:text-fg-muted",
  "project-group-chevron-collapsed": "rotate-90-ccw",
  /* Flat folder stack — both glyphs absolute; active/idle crossfade + scale. */
  "project-group-folder":
    "relative shrink-0 inline-block w-3.5 h-3.5 text-fg-secondary",
  "project-group-icon":
    "absolute inset-0 w-3.5 h-3.5 block transition-[opacity,transform] duration-fast ease-soft",
  "project-group-icon-active": "opacity-100 scale-100",
  "project-group-icon-idle": "opacity-0 scale-90 pointer-events-none",
  /* text-nav owns font-size + line-height (--line-height-nav-item). Do not
   * add leading-*: Uno emits text-nav after leading utilities, so a tighter
   * token would win and clip descenders (g/y/p) again. overflow-x-hidden
   * (not overflow-hidden): ellipsis still truncates long names, but Inter
   * ink that slightly exceeds the 20px line box ("grok-desktop") is not
   * sheared. Full primary ink for every folder name; active
   * (project-group-active → font-medium) is the weight lift that marks
   * the current project. */
  "project-group-name":
    "min-w-0 flex-1 pr-0.5 text-nav font-normal text-fg whitespace-nowrap overflow-x-hidden text-ellipsis transition-colors duration-fast ease-soft",
  /* Count badge only — pin belongs on session rows, not the folder.
   * Box is px (html is 13px; rem h-4.5 collapses to ~15px and the digit
   * sits high in the pill). Line-height equals height so "1" / "18" sit
   * on the optical center; do not use rem h-* or leading-none here. */
  "project-group-count":
    "shrink-0 inline-flex items-center justify-center box-border min-w-[18px] h-[18px] px-[6px] rounded-pill bg-white-soft text-fg-muted text-[10px] font-medium tabular-nums leading-[18px]",
  /* Nested list: left guide line under the folder glyph. */
  "project-group-sessions":
    "relative flex flex-col gap-1.5 ml-[18px] pl-2 before:(content-[''] absolute left-0 top-1 bottom-1 w-px bg-line-subtle)",
  /* Row stack inside a project / no-project group. 6px gap (px, not rem)
   * so titles do not stack like a compact file tree. More/less sit outside
   * so the chip stays under the viewport while long lists scroll. */
  "project-group-session-list": "flex flex-col gap-[4px] min-h-0",
  /*
   * After "Show more": keep 8 session rows in view (36px row + 6px gap).
   * Extra rows scroll here. 25 packed 32px rows filled the rail.
   */
  "project-group-session-list-scroll":
    "max-h-[calc(36px*8+6px*7)] overflow-y-auto overscroll-contain",
  /*
   * "No project" section: sibling of the project tree, not a folder in it.
   * Head reuses project-group-main / -chevron / -count for identical 36px
   * hit targets, but the label is section-cased (uppercase, muted) so it
   * reads as a category next to PROJECTS instead of a workspace name.
   * Sticky + opaque bg-sidebar for the same reason folder headers are:
   * rows scroll under it. min-h is px (same rem-collapse trap as folders).
   * mt-1 with a hairline rule separates it from the last project group.
   */
  "loose-group": "flex flex-col gap-px pt-1.5 pb-1.5 border-t border-line-subtle",
  "loose-group-active": "[&_.loose-group-name]:text-fg",
  "loose-group-collapsed": "pb-0.5",
  "loose-group-header":
    "sticky top-0 z-10 flex items-center gap-1.5 min-h-[36px] pr-1.5 bg-sidebar shadow-[0_-1px_0_0_var(--color-bg-sidebar)] before:(content-[''] absolute inset-0 z-[-1] rounded-8px bg-transparent pointer-events-none transition-colors duration-fast ease-soft) hover:before:bg-sidebar-hover",
  /* Section-cased label: matches project-section-label ink/size, no px-2.5
   * (project-group-main already owns the row inset). No glyph — a 14px
   * stroke next to 10px tracked caps fights the quiet section read. */
  "loose-group-name":
    "min-w-0 flex-1 pr-0.5 text-10px font-medium tracking-[0.08em] uppercase text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis leading-none transition-colors duration-fast ease-soft",
  /* Flat list — no tree guide (there is no folder to nest under), but the same
   * left inset as project rows so titles line up across both sections. */
  "loose-group-sessions": "flex flex-col gap-1.5 ml-[18px] pl-2",
  /*
   * Preview chip ("Show N more" / "Show less").
   * appearance-none + overflow-hidden + a fixed 28px box so the fill clips
   * to the same 7px radius on every corner — native <button> bezels on
   * macOS round the top more than the bottom. Height is px because html
   * font-size is 13px (rem h-* shrinks). Resting faint well so the radius
   * is visible without hover; my/mt keep the chip off the last row and
   * the scrollport edge so overflow cannot clip the bottom.
   */
  "project-group-more":
    "flex items-center box-border appearance-none w-full shrink-0 h-[28px] mt-0.5 mb-0.5 px-2 border-none rounded-7px overflow-hidden bg-white-faint text-left text-11px leading-none text-fg-muted cursor-pointer transition-colors duration-fast ease-soft hover:(text-fg-secondary bg-white-soft) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
  /* Legacy aliases. */
  "time-group": "flex flex-col gap-0.5 pb-3",
  "time-group-label":
    "px-2.5 pt-1.5 pb-2 text-11px font-normal tracking-wide text-fg-muted",
  /*
   * Session rows: title | trailing action parent (rename + pin + remove).
   * One 56px `sess-actions` track owns the three 14×28 buttons (`sess-btns`,
   * right-aligned, 2px gaps) plus a 24px time overlay on the right — hover-
   * reveal does not shift the title truncation point, and the trailing ×
   * shares the timestamp's right edge. Height uses px (html font-size is
   * 13px; rem h-* collapses). No leading status dot; live / waiting only
   * lift title color; selection is elevated pill + medium title.
   */
  /*
   * pr-2.5 (not pr-1.5): keeps the action track (relative time / streaming
   * "…" / remove) a touch clear of the pill's right edge. Scoped to the row
   * only so folder headers, scroll inset, and count badges stay put.
   */
  "sess-row":
    "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 w-full h-[36px] pl-2.5 pr-2.5 rounded-8px cursor-pointer text-fg-secondary transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) data-[dragging=true]:(opacity-45) data-[drag-over=true]:(bg-white-soft shadow-[inset_0_2px_0_0_var(--color-text-primary)])",
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
  /*
   * Editing: keep the rename/save control solid (same parent-selector trick
   * as the pinned pin) so the user can confirm without hunting a hover target.
   */
  "sess-row-editing":
    "[&_.sess-rename]:(opacity-100 pointer-events-auto text-fg)",
  /* Same text-nav line-height as folder names — see --line-height-nav-item.
   * overflow-x-hidden matches project-group-name so a session titled
   * "grok-desktop" does not lose its p/g either. */
  "sess-title":
    "block min-w-0 max-w-full whitespace-nowrap overflow-x-hidden text-ellipsis text-nav font-normal tracking-tight",
  /*
   * Inline rename field: same 20px text-nav box as `.sess-title` so swapping
   * span → input does not grow the 36px row. No border, no focus ring, no
   * UA padding — the caret is the only edit chrome.
   */
  "sess-title-input":
    "h-[20px] box-border border-none outline-none shadow-none appearance-none bg-transparent p-0 m-0 rounded-none select-text caret-fg focus-visible:outline-none",
  /*
   * Parent track stays 56px so the resting time keeps its position. The
   * three 14×28 buttons no longer pack from the left: `sess-btns` fills the
   * track and right-aligns (`justify-end`), so the trailing remove glyph
   * lands on the same right edge as the `13h` timestamp painted above it.
   * Left-packing put the × ~8px inboard of that edge and read as a ragged
   * second column. 14*3 + 2*2 gap = 46px, so the cluster still clears the
   * time's 24px overlay box.
   */
  "sess-actions": "relative shrink-0 w-[56px] h-[28px]",
  "sess-btns": "flex items-center justify-end gap-[2px] w-full h-[28px]",
  /*
   * Rename / pin / remove share one 14×28 chrome string (keep them in
   * lockstep). Width/height are px — html font-size is 13px, so rem
   * `w-4` / `h-7` collapse to 13×23 and leave a hole after the cluster.
   * The box is 14px wide (not 16) with a 2px gap so the glyphs breathe
   * instead of reading as one welded strip; height stays 28px because it is
   * invisible hit area, not chrome. Hidden at rest; visible on row hover /
   * focus. Pinned / editing visibility is forced by the row parent selectors
   * so this base opacity-0 cannot win. No hover fill — one cluster, one cadence.
   */
  "sess-rename":
    "shrink-0 flex items-center justify-center w-[14px] h-[28px] p-0 m-0 border-none rounded-6px bg-transparent text-fg-muted cursor-pointer opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:text-fg focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)] rounded-6px)",
  "sess-rename-save": "text-fg",
  "sess-rename-icon": "w-[13px] h-[13px] block shrink-0",
  "sess-pin":
    "shrink-0 flex items-center justify-center w-[14px] h-[28px] p-0 m-0 border-none rounded-6px bg-transparent text-fg-muted cursor-pointer opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:text-fg focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)] rounded-6px)",
  "sess-pin-active": "text-fg",
  "sess-pin-icon": "w-[13px] h-[13px] block shrink-0",
  "sess-remove":
    "shrink-0 flex items-center justify-center w-[14px] h-[28px] p-0 m-0 border-none rounded-6px bg-transparent text-fg-muted cursor-pointer opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:text-fg focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)] rounded-6px)",
  "sess-remove-icon": "w-[13px] h-[13px] block shrink-0",
  /*
   * Resting time: right 24px of `sess-actions` (fits `45s` / `now` / `1d`
   * / `1mo` at 10px tabular-nums). Hidden on hover / focus so remove — now
   * the right-most slot of the same track — can take that edge. The 2px
   * `pr-0.5` here is what the × glyph's own stroke inset lines up against.
   * pointer-events-none: it is display-only.
   */
  "sess-time":
    "absolute right-0 top-0 flex items-center justify-end w-[24px] h-[28px] pr-0.5 text-10px leading-none text-fg-muted whitespace-nowrap tabular-nums text-right pointer-events-none group-hover:opacity-0 group-focus-within:opacity-0",
  "side-nav-footer":
    "mt-auto px-3.5 pt-2.5 pb-1 border-t border-line-subtle flex flex-col gap-2.5",
  "side-nav-quota":
    "grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-2 gap-y-1.5 px-0.5 items-center",
  /*
   * Menu open: keep layout (chip anchor stable) but drop paint so the light
   * density track cannot show under the upward workspace popover.
   */
  "side-nav-quota-suppressed": "invisible pointer-events-none",
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
