/**
 * Shell / top-nav / main column / banners UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const shellShortcuts: Record<string, string> = {
    /* ── Shell ── */
    "app-shell": "flex h-full w-full overflow-hidden bg-app text-fg",
    /* ≤900px: full-bleed main (sidebar overlays) so chat keeps usable width */
    "main-column":
      "flex flex-1 flex-col ml-sidebar h-full min-w-0 relative max-[900px]:ml-0",
    /*
     * right transition lives on top-nav (not top-nav-railed): on close the railed
     * class is removed in the same frame as the drawer slide; if transition only
     * lived on the removed class, right would snap while the rail still eases out.
     * Match context-drawer: duration-slow + ease-out.
     */
    "top-nav":
      "fixed top-0 right-0 left-sidebar z-40 flex items-center justify-between gap-2 sm:gap-3 h-topnav px-2 sm:px-container border-b border-transparent bg-titlebar backdrop-blur-20px max-[900px]:left-0 transition-[right] duration-slow ease-out",
    /* flex-1 claims space vs shrink-0 right; overflow-hidden clips so chips never paint over nav */
    "top-nav-left":
      "flex flex-1 items-center gap-1.5 sm:gap-2.5 min-w-0 overflow-hidden",
    "top-nav-session-title":
      "min-w-0 flex-1 text-sm font-medium tracking-tight text-fg whitespace-nowrap overflow-hidden text-ellipsis",
    "top-nav-sync":
      "inline-flex items-center gap-1.5 h-6 px-2.25 rounded-pill bg-white-faint text-fg-muted text-11px leading-none whitespace-nowrap shrink-0 transition-colors duration-normal ease-soft max-[380px]:hidden",
    "top-nav-sync-dot": "w-1.25 h-1.25 rounded-full bg-fg-muted shrink-0",
    "top-nav-sync-live": "text-fg-secondary [&>.top-nav-sync-dot]:(bg-fg-secondary shadow-[0_0_0_3px_var(--color-accent-muted)])",
    "top-nav-sync-warn": "text-fg-secondary bg-white-soft",
    "top-nav-meta":
      "text-11px text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis max-w-70",
    "top-nav-right": "flex items-center gap-1 sm:gap-2 shrink-0",
    /* Active state shared by context toggle + ⋯ open */
    "top-nav-link-active": "text-fg bg-white-soft",
    "top-nav-actions":
      "flex items-center gap-0.5 shrink-0",
    "top-nav-icon-btn":
      "relative flex items-center justify-center w-7.5 h-7.5 border-none rounded-8px bg-transparent text-fg-muted text-16px leading-none transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-surface)])",
    /* Context rail (plan) toggle with optional step badge */
    "top-nav-context-btn": "relative",
    "top-nav-context-badge":
      "absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.75 flex items-center justify-center rounded-pill bg-primary text-on-primary text-9px font-semibold leading-none",
    /* Opens session rail overlay ≤900px (rail is off-canvas by default) */
    "top-nav-rail-btn":
      "hidden max-[900px]:flex items-center justify-center w-7.5 h-7.5 shrink-0 border-none rounded-8px bg-transparent text-fg-muted text-16px leading-none transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-surface)])",
    /* Session ⋯ overflow menu (fork/rewind/media slash) */
    "top-nav-menu": "relative shrink-0",
    "top-nav-menu-list":
      "absolute right-0 top-[calc(100%+6px)] z-80 m-0 p-1.5 list-none min-w-64 max-h-[min(70vh,420px)] overflow-y-auto rounded-shell border border-line-subtle bg-elevated shadow-popover animate-overlay-in",
    "top-nav-menu-item":
      "flex w-full items-center justify-between gap-3 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "top-nav-menu-item-danger": "text-danger hover:bg-danger-muted",
    "top-nav-menu-label": "min-w-0 font-medium",
    "top-nav-menu-hint": "shrink-0 text-11px text-fg-muted font-mono",
    /*
     * padding-right transition lives on main-body (not main-body-railed): same
     * close-frame issue as top-nav — transition must survive class removal so
     * the middle column eases open while the drawer translates out (duration-slow).
     */
    "main-body":
      "flex flex-1 min-h-0 pt-topnav transition-[padding-right] duration-slow ease-out",
    /* When plan/preview drawer is open in push mode — shrink top-nav + main with the rail width. */
    "top-nav-railed": "right-rail",
    "main-body-railed": "pr-rail",
    /* min-h-0 so the timeline flex child can scroll; composer is in-flow (not
     * absolute) so message bottoms never sit under the dock. */
    main: "flex flex-1 flex-col min-h-0 min-w-0 relative bg-timeline",
    banner:
      "mx-container mt-2.5 px-3 py-2.25 rounded-10px text-12px leading-snug border border-line-subtle bg-white-faint text-fg-secondary shrink-0",
    "banner-danger":
      "border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-danger-muted text-danger",
    "banner-warning": "border-line-muted bg-white-soft text-fg-secondary",
    "history-banner": "mt-2.5 mx-container",
};
