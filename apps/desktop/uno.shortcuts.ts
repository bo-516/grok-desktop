/**
 * Semantic UnoCSS shortcuts for grok-desktop shell / timeline / composer.
 * Colors always resolve through defineColor tokens via theme color names.
 */

export const appShortcuts: Record<string, string> = {

    /* ── Shell ── */
    "app-shell": "flex h-full w-full overflow-hidden bg-app text-fg",
    /* max-sm: full-bleed main (sidebar overlays) so ≥320 top-nav stays usable */
    "main-column":
      "flex flex-1 flex-col ml-sidebar h-full min-w-0 relative max-sm:ml-0",
    "top-nav":
      "fixed top-0 right-0 left-sidebar z-40 flex items-center justify-between gap-2 sm:gap-3 h-topnav px-2 sm:px-container border-b border-transparent bg-titlebar backdrop-blur-20px max-sm:left-0",
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
    /* Opens session rail overlay below sm (rail is off-canvas by default) */
    "top-nav-rail-btn":
      "hidden max-sm:flex items-center justify-center w-7.5 h-7.5 shrink-0 border-none rounded-8px bg-transparent text-fg-muted text-16px leading-none transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-surface)])",
    /* Session ⋯ overflow menu (fork/rewind/media slash) */
    "top-nav-menu": "relative shrink-0",
    "top-nav-menu-list":
      "absolute right-0 top-[calc(100%+6px)] z-80 m-0 p-1.5 list-none min-w-52 max-h-[min(70vh,420px)] overflow-y-auto rounded-shell border border-line-subtle bg-elevated shadow-popover animate-overlay-in",
    "top-nav-menu-item":
      "flex w-full items-center justify-between gap-3 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "top-nav-menu-item-danger": "text-danger hover:bg-danger-muted",
    "top-nav-menu-label": "min-w-0 font-medium",
    "top-nav-menu-hint": "shrink-0 text-11px text-fg-muted font-mono",
    "main-body": "flex flex-1 min-h-0 pt-topnav",
    /* min-h-0 so the timeline flex child can scroll; composer is in-flow (not
     * absolute) so message bottoms never sit under the dock. */
    main: "flex flex-1 flex-col min-h-0 min-w-0 relative bg-timeline",
    banner:
      "mx-container mt-2.5 px-3 py-2.25 rounded-10px text-12px leading-snug border border-line-subtle bg-white-faint text-fg-secondary shrink-0",
    "banner-danger":
      "border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-danger-muted text-danger",
    "banner-warning": "border-line-muted bg-white-soft text-fg-secondary",
    "history-banner": "mt-2.5 mx-container",

    /* ── Side nav ──
     * Desktop: fixed 272px column. max-sm: off-canvas overlay so top-nav
     * gets the full ≥320 viewport (review #4 reachability). */
    "side-nav":
      "fixed left-0 top-0 z-50 flex flex-col w-sidebar h-full py-2 border-r border-line-subtle bg-sidebar transition-transform duration-normal ease-soft max-sm:translate-x-[-100%] max-sm:z-100 max-sm:shadow-modal max-sm:data-[open=true]:translate-x-0",
    "side-nav-backdrop":
      "fixed inset-0 z-90 bg-overlay border-none p-0 m-0 cursor-default max-sm:block",
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
      "shrink-0 inline-flex items-center justify-center min-w-6 h-5.5 px-1.5 rounded-kbd bg-kbd text-fg-muted font-sans text-11px font-normal tracking-normal leading-none",
    "side-nav-kbd-btn":
      "border-none cursor-pointer hover:(text-fg bg-white-soft)",
    "side-nav-footer-btn":
      "flex w-full items-center justify-between gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg-secondary transition-colors duration-fast ease-soft hover:(text-fg bg-white-faint)",
    /* Workspace nav (Settings / Tasks / Overview / Extensions) in footer */
    "side-nav-nav": "flex flex-col gap-0.5",
    "side-nav-nav-badge":
      "shrink-0 inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-pill bg-white-soft text-fg-muted text-10px font-medium tabular-nums",
    "side-nav-search-wrap":
      "flex items-center gap-2 w-full h-8.5 px-2.5 rounded-9px bg-white-faint transition-colors duration-normal ease-soft focus-within:bg-white-soft",
    "side-nav-search-icon":
      "shrink-0 text-fg-muted text-13px leading-none opacity-75",
    "side-nav-search":
      "flex-1 min-w-0 h-full border-none bg-transparent text-fg text-nav p-0 placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-sidebar)])",
    "side-nav-scroll":
      "flex-1 overflow-y-auto min-h-0 px-3 pb-2 pt-1 flex flex-col gap-1",
    "side-nav-empty": "px-2.5 py-4 text-12px text-fg-muted leading-snug",
    /*
     * Row gap must stay ≥6px: with 8px radius + active/hover fills, gap-0.5 (~2px
     * at 16px rem, ~1.6px when html is 13px) makes adjacent pills look stacked /
     * overlapping. Prefer px so spacing is stable under the 13px root font-size.
     */
    "time-group": "flex flex-col gap-[6px] pb-2.5",
    "time-group-label":
      "px-2.5 pt-2.5 pb-1.5 text-11px font-medium tracking-wide text-fg-muted",
    /* Design §4.3 session row height 44–52px. Use px (not h-11/rem): html font-size
     * is --font-size-body-sm (13px), so rem-based h-11 collapses to ~36px.
     * Grid + minmax(0,1fr) hard-caps the title so long names never paint over the
     * relative-time / remove meta slot (flex min-w-0 alone was intermittent).
     * Remove is absolute inside sess-meta so it replaces time on hover without
     * changing title width; center with top/bottom + my-auto (not -translate-y)
     * because preflight is off and Uno transform CSS vars leave transform invalid. */
    "sess-row":
      "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 w-full h-[44px] px-2.5 rounded-8px cursor-pointer text-fg-secondary transition-colors duration-normal ease-soft hover:(text-fg bg-white-faint)",
    "sess-row-active": "bg-high text-fg hover:(bg-high text-fg)",
    "sess-row-process-live": "[&_.sess-title]:text-fg",
    "sess-title":
      "block min-w-0 max-w-full whitespace-nowrap overflow-hidden text-ellipsis text-nav font-normal tracking-tight leading-none",
    /* Owns the time label + hover remove control so title never shares that paint. */
    "sess-meta":
      "relative shrink-0 flex items-center justify-end min-w-[1.75rem] h-5",
    "sess-time":
      "shrink-0 text-11px leading-none text-fg-muted opacity-90 whitespace-nowrap tabular-nums transition-opacity duration-fast ease-soft group-hover:opacity-0 group-focus-within:opacity-0",
    "sess-remove":
      "absolute right-0 top-0 bottom-0 my-auto h-5 w-5 flex items-center justify-center border-none bg-transparent text-fg-muted text-15px leading-none rounded-soft opacity-0 pointer-events-none transition-opacity duration-fast ease-soft group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:(text-fg bg-white-soft)",
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
      "flex items-center gap-2.5 w-full px-2 py-1.5 border-none rounded-8px bg-transparent text-fg-secondary text-left transition-colors duration-normal ease-soft hover:(bg-white-faint text-fg)",
    "side-nav-avatar":
      "flex items-center justify-center w-5.5 h-5.5 rounded-pill bg-primary text-on-primary text-11px font-semibold shrink-0",
    "side-nav-user-meta": "flex-1 min-w-0 flex flex-col gap-px",
    "side-nav-user-name":
      "text-nav text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-fg",
    "side-nav-user-status": "text-11px text-fg-muted",
    "side-nav-user-action":
      "shrink-0 w-7 h-7 flex items-center justify-center rounded-7px text-fg-muted text-14px opacity-70 transition-all duration-fast ease-soft group-hover:(opacity-100 bg-white-faint)",

    /* ── Timeline ── */
    /* Bottom padding is modest: composer sits in flex flow under the timeline,
     * so we no longer reserve a fixed absolute-dock gutter (pb-42). */
    timeline:
      "flex-1 min-h-0 overflow-y-auto px-container pt-7 pb-5 flex flex-col gap-7 w-full scroll-smooth",
    empty:
      "m-auto text-center text-fg-muted px-6 py-12 flex flex-col items-center gap-2",
    "empty-title":
      "m-0 text-18px font-medium tracking-tight text-fg-secondary",
    "empty-sub": "m-0 text-13px leading-snug text-fg-muted max-w-md",
    "msg-user-wrap": "flex flex-col items-end w-full gap-1.5",
    "item-user":
      "max-w-[min(80%,48rem)] px-3.75 py-2.75 rounded-bubble bg-user text-fg text-body-md tracking-tight whitespace-pre-wrap break-words",
    "msg-time":
      "text-12px leading-none text-fg-secondary opacity-85 px-0.5",
    "msg-agent-wrap": "flex justify-start w-full",
    "msg-agent-inner":
      "w-full flex flex-col gap-2.5",
    "item-agent": "p-0 text-body-md tracking-tight text-fg break-words",
    "msg-status":
      "inline-flex items-center gap-2 text-11px text-fg-secondary py-0.5",
    "msg-status-bars":
      "flex flex-col gap-2.5 w-[min(100%,28rem)] pt-1 pb-2",
    "msg-status-bar":
      "h-2.75 rounded-pill bg-skeleton animate-skeleton-pulse",
    "msg-status-bar-mid":
      "h-2.75 rounded-pill w-[72%] bg-skeleton-mid animate-skeleton-pulse animate-delay-120",
    "msg-status-bar-faint":
      "h-2.75 rounded-pill w-[44%] bg-skeleton-faint animate-skeleton-pulse animate-delay-240",
    "msg-actions":
      "flex items-center gap-0.5 p-0 opacity-0 transition-opacity duration-normal ease-soft group-hover:opacity-100 group-focus-within:opacity-100",
    "msg-action-btn":
      "border-none bg-transparent text-fg-muted text-12px px-2 py-1.25 rounded-7px transition-colors duration-fast ease-soft hover:(text-fg bg-white-faint)",
    "item-thought":
      "max-w-full bg-transparent border-none text-fg-muted text-11px",
    "thought-toggle":
      "inline-flex items-center gap-1.5 w-auto max-w-full border-none rounded-9px bg-white-faint px-2.75 py-2 text-left text-fg-muted font-normal text-11px leading-tight transition-colors duration-normal ease-soft hover:(bg-white-soft text-fg-secondary)",
    "thought-chevron": "w-2 text-fg-faint text-12px leading-none shrink-0",
    "thought-content":
      "mt-1.5 border-none rounded-9px bg-white-faint px-3 py-2.5 text-fg-secondary text-12px leading-snug whitespace-pre-wrap break-words",
    "item-tool":
      "max-w-full bg-white-faint border-none rounded-shell px-3 py-2.5",
    "item-error":
      "max-w-full border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-danger-muted rounded-card px-3 py-2.5 text-danger text-13px",
    "tool-head":
      "flex justify-between items-center gap-2 mb-2 text-fg-secondary text-12px",
    "tool-kind-label":
      "inline-flex items-center rounded-pill bg-white-soft px-1.75 py-0.5 text-10px font-medium uppercase tracking-wide text-fg-muted mr-1.5",
    "tool-mcp":
      "font-mono text-11px text-fg-secondary",
    /* File path chips — must set bg/border or native button paints OS white-out */
    "tool-locations":
      "flex flex-col gap-1 mb-2 min-w-0 max-w-full",
    "tool-loc-link":
      "block w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-11px leading-snug px-2.5 py-1.25 rounded-8px border-none bg-high text-fg-secondary transition-colors duration-fast ease-soft hover:(bg-highest text-fg)",
    "tool-content":
      "m-0 mt-1 max-h-64 overflow-auto font-mono text-11px leading-relaxed text-fg-secondary whitespace-pre-wrap break-words",
    "tool-error": "text-danger",
    /* Collapsed read/search/list groups (ToolGroupView) */
    "tool-group":
      "flex flex-col gap-1.5 max-w-full",
    "tool-group-toggle":
      "inline-flex items-center gap-1.5 w-auto max-w-full border-none rounded-9px bg-white-faint px-2.75 py-2 text-left text-fg-muted font-normal text-11px leading-tight transition-colors duration-normal ease-soft hover:(bg-white-soft text-fg-secondary)",
    badge:
      "text-10px px-1.75 py-0.5 rounded-pill bg-white-soft text-fg-secondary",
    "badge-pending": "bg-white-soft text-fg-secondary",
    "badge-failed": "bg-danger-muted text-danger",
    "badge-ok": "bg-white-soft text-fg-muted",
    "mini-diff":
      "font-mono text-11px border-none rounded-8px overflow-hidden bg-white-faint",
    "mini-diff-path":
      "px-2.5 py-1.25 text-fg-secondary border-b border-line-subtle break-all",
    "mini-diff-add":
      "bg-diff-add-bg text-diff-add px-2.5 py-0.5 whitespace-pre-wrap break-words",
    "mini-diff-del":
      "bg-diff-del-bg text-diff-del px-2.5 py-0.5 whitespace-pre-wrap break-words",
    "msg-chips": "flex flex-wrap gap-1.5 pt-0.5",
    "msg-chip":
      "inline-flex items-center gap-1.5 h-5.25 px-2.25 rounded-pill bg-white-faint text-fg-muted text-11px leading-none border-none transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg-secondary)",

    /* ── Markdown ── */
    "md-root": "flex flex-col gap-[0.55em]",
    "md-p": "m-0 whitespace-pre-wrap",
    "md-blank": "h-[0.35em]",
    "md-h":
      "mt-[0.45em] mb-[0.1em] font-semibold text-fg leading-snug tracking-tight",
    "md-h1": "text-[1.2em]",
    "md-h2": "text-[1.08em]",
    "md-h3": "text-[1.02em]",
    "md-h4": "text-[1.02em]",
    "md-list": "my-[0.1em] pl-[1.25em] [&>li]:my-[0.2em] [&>li]:marker:text-fg-muted",
    "md-inline-code":
      "font-mono text-[0.88em] px-[0.4em] py-[0.12em] rounded-1.5 bg-white-faint text-fg border-none",
    "md-pre":
      "my-[0.35em] px-3.5 py-3 overflow-x-auto rounded-shell bg-white-faint border-none font-mono text-12px leading-relaxed text-fg [&>code]:(font-inherit whitespace-pre)",
    "md-pre-open": "opacity-95",
    "md-link":
      "text-fg underline underline-offset-2 decoration-line-strong transition-colors duration-fast ease-soft hover:decoration-fg",
    "md-cursor": "inline ml-px text-fg-muted animate-cursor-blink",

    /* ── Composer ── */
    /* In-flow footer (not absolute): height is natural; timeline scrolls above.
     * shrink-0 keeps the dock from collapsing when the timeline is long. */
    "composer-dock":
      "shrink-0 relative z-20 px-container pt-2 pb-5 bg-timeline pointer-events-none",
    "composer-dock-inner": "w-full pointer-events-auto",
    composer:
      "relative flex flex-col gap-2.5 px-3.5 pt-3.5 pb-2.75 rounded-dock border border-transparent bg-composer shadow-composer transition-all duration-normal ease-soft focus-within:(border-line-focus)",
    "composer-input-wrap":
      "relative w-full min-h-11 max-h-40 overflow-hidden",
    "composer-input-highlight":
      "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pt-0.5 px-0.5 text-body-md leading-relaxed tracking-tight text-fg",
    "composer-input":
      "relative z-1 w-full min-h-11 max-h-40 resize-none border-none bg-transparent pt-0.5 px-0.5 text-body-md leading-relaxed tracking-tight text-transparent caret-fg placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-2 ring-offset-[var(--color-bg-composer)] rounded-soft)",
    /* Mention chip chrome is only in base.css — dynamic class names + must not
     * change glyph metrics (font-weight/padding) or the caret misaligns. */
    /*
     * Slash / @ menu: each row is shrink-0 so a flex-col + overflow-y parent
     * never compresses items (min-h-0 + default shrink caused text to paint over neighbors).
     */
    "composer-suggestions":
      "absolute right-0 bottom-[calc(100%+8px)] left-0 flex max-h-80 flex-col overflow-x-hidden overflow-y-auto border border-line-suggestion rounded-card bg-composer-suggestion shadow-composer-suggestions animate-overlay-in py-1",
    "composer-suggestion":
      "block w-full shrink-0 overflow-hidden border-none border-b border-line-subtle bg-transparent px-3 py-2.5 m-0 text-left text-fg transition-colors duration-fast ease-soft hover:bg-composer-suggestion-hover last:border-b-0",
    "composer-suggestion-active": "bg-composer-suggestion-hover",
    "composer-suggestion-main":
      "flex w-full min-w-0 flex-col gap-0.5",
    "composer-suggestion-title-row":
      "flex w-full min-w-0 items-center gap-1.75",
    /* Kind glyph from the shared MentionIconView; never shrinks so long paths
     * truncate in the label instead of squashing the icon. */
    "composer-suggestion-icon": "shrink-0 w-3.5 h-3.5",
    "composer-suggestion-label":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-medium tracking-tight leading-5",
    "composer-suggestion-detail":
      "block w-full m-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-suggestion-detail text-11px leading-4",
    /* ACP input.hint on its own line — never concatenated into description. */
    "composer-suggestion-hint":
      "block w-full m-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10px leading-4 text-fg-muted",
    "composer-suggestion-kind":
      "shrink-0 rounded-pill px-2 py-0.5 text-10px font-medium leading-none",
    "composer-suggestion-kind-file":
      "text-mention-file bg-mention-file-bg",
    "composer-suggestion-kind-directory":
      "text-mention-dir bg-mention-dir-bg",
    "composer-suggestion-kind-command":
      "text-mention-command bg-mention-command-bg",
    "composer-suggestion-kind-skill":
      "text-mention-skill bg-mention-skill-bg",
    "composer-suggestions-empty":
      "m-0 p-3 text-fg-suggestion-detail text-body-sm",
    "composer-bar": "flex items-center justify-between gap-2 m-0",
    "composer-bar-left": "flex items-center gap-1 min-w-0",
    "composer-bar-right": "relative flex items-center gap-1.5 min-w-0",
    "composer-icon-btn":
      "flex items-center justify-center w-7.5 h-7.5 border-none rounded-8px bg-transparent text-fg-secondary text-15px transition-colors duration-fast ease-soft hover:enabled:(bg-white-faint text-fg)",
    "composer-chip-btn":
      "flex items-center gap-1.25 h-7.5 px-2.25 border-none rounded-8px bg-transparent text-fg-secondary text-12px font-normal transition-colors duration-fast ease-soft hover:enabled:(bg-white-faint text-fg)",
    "composer-chip-btn-active":
      "bg-primary text-on-primary hover:enabled:(bg-accent-hover text-on-primary)",
    /* Agent mode control (sole mode UI — not top-nav) */
    "composer-mode": "relative shrink-0",
    "composer-mode-trigger":
      "flex items-center gap-1.25 h-7.5 px-2.25 border-none rounded-8px bg-white-faint text-fg-secondary text-12px font-normal transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) disabled:(opacity-70 cursor-wait)",
    "composer-mode-trigger-pending": "text-fg-muted",
    "composer-mode-build": "text-fg-secondary",
    "composer-mode-plan":
      "text-fg-secondary bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]",
    "composer-mode-ask": "text-fg-muted",
    "composer-mode-label": "whitespace-nowrap",
    "composer-mode-chevron": "text-10px opacity-70",
    "composer-mode-spinner": "text-fg-muted",
    "composer-mode-menu":
      "absolute left-0 bottom-[calc(100%+8px)] z-30 min-w-56 w-max max-w-72 rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 flex flex-col gap-0.5 animate-modal-in",
    "composer-mode-option":
      "flex w-full items-start gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-mode-option-active": "bg-white-soft",
    "composer-mode-option-check":
      "w-3.5 shrink-0 text-fg-secondary text-12px leading-5",
    "composer-mode-option-text": "min-w-0 flex flex-col gap-0.5",
    "composer-mode-option-label": "font-medium text-fg",
    "composer-mode-option-desc": "text-11px text-fg-muted leading-snug",
    "composer-mode-hint":
      "m-0 mt-1 px-2.5 py-1.5 text-10px text-fg-muted border-t border-line-subtle",
    "composer-model-trigger":
      "flex items-center gap-1.5 h-7.5 px-2.5 border-none rounded-pill bg-white-faint text-fg-secondary text-12px font-normal whitespace-nowrap transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg) aria-expanded:bg-white-soft aria-expanded:text-fg",
    "composer-model-trigger-dot":
      "w-1 h-1 rounded-full bg-fg-muted opacity-70",
    "composer-menu":
      "absolute right-0 bottom-[calc(100%+8px)] z-30 min-w-56 w-max max-w-72 rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 animate-modal-in",
    "composer-menu-row":
      "flex w-full items-center justify-between gap-3 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-menu-row-active": "bg-white-faint",
    "composer-menu-label": "text-fg-muted shrink-0",
    "composer-menu-value":
      "flex items-center gap-1.5 min-w-0 text-fg font-medium",
    "composer-menu-chevron": "text-fg-muted text-11px opacity-70",
    "composer-menu-divider":
      "my-1.5 h-px border-none bg-line-subtle",
    "composer-menu-sub":
      "absolute right-[calc(100%+6px)] bottom-0 z-40 min-w-44 max-h-64 overflow-y-auto rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 animate-overlay-in",
    "composer-menu-item":
      "flex w-full items-center justify-between gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-menu-item-active": "bg-white-soft",
    "composer-menu-check": "text-fg-secondary text-12px",
    "composer-send":
      "flex items-center justify-center w-8 h-8 border-none rounded-pill bg-primary text-on-primary text-14px font-semibold transition-all duration-fast ease-soft hover:enabled:bg-accent-hover active:enabled:scale-96 disabled:(opacity-35 cursor-not-allowed)",
    "composer-stop":
      "flex items-center justify-center h-8 px-3 border border-line-muted rounded-pill bg-white-faint text-fg-secondary text-12px font-medium transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg)",
    "composer-hint": "text-11px text-fg-muted tracking-normal",
    "composer-hint-footer": "mt-2 mb-0 text-center opacity-85",
    "composer-hint-warn": "mt-1.5 mx-1 mb-0 text-center text-fg-secondary",
    "composer-hint-kbd": "opacity-75",

    /* ── Chrome / modal / plan ── */
    chip:
      "border-none bg-white-faint text-fg-secondary rounded-pill px-2.25 py-1 text-11px leading-none",
    btn: "rounded-control border border-line-subtle bg-white-faint text-fg px-3 py-1.5 text-12px transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft border-line-muted) disabled:(opacity-45 cursor-not-allowed)",
    "btn-primary":
      "bg-primary border-primary text-on-primary hover:enabled:(bg-accent-hover border-accent-hover)",
    "btn-danger":
      "border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-danger bg-danger-muted",
    "btn-ghost":
      "rounded-control border border-transparent bg-transparent text-fg-secondary px-2.5 py-1.25 text-12px transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) disabled:(opacity-45 cursor-not-allowed)",
    "btn-new":
      "text-11px border-none bg-accent text-fg-inverse rounded-8px px-2 py-1 cursor-pointer",
    "rail-right":
      "w-rail-right shrink-0 flex flex-col min-h-0 border-l border-line-subtle bg-surface",
    "rail-head":
      "flex justify-between items-center px-4 py-3.5 text-12px tracking-wide text-fg-secondary border-b border-line-subtle",
    "context-rail": "flex flex-col min-h-0",
    "context-rail-head": "",
    "context-rail-body": "flex-1 min-h-0 overflow-y-auto",
    "plan-empty": "p-4 text-fg-muted text-12px leading-snug",
    "plan-step":
      "flex gap-2.5 px-4 py-2.5 text-12px leading-snug text-fg-secondary border-b border-line-subtle last:border-b-0",
    /* Full-screen dimmer shared by confirm dialogs + command palette */
    overlay:
      "fixed inset-0 bg-overlay flex items-center justify-center z-100 animate-overlay-in",
    "modal-backdrop":
      "fixed inset-0 bg-overlay flex items-center justify-center z-100 animate-overlay-in",
    modal:
      "w-[min(420px,92vw)] bg-container border border-line-subtle rounded-modal shadow-modal p-5 animate-modal-in",
    /* Confirm dialog shell (ConfirmDialogView) — elevated surface, never white-out */
    "modal-panel":
      "w-[min(420px,92vw)] bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal p-5 animate-modal-in flex flex-col gap-3",
    "modal-title":
      "m-0 text-15px font-medium tracking-tight text-fg",
    "modal-details":
      "m-0 pl-4.5 text-13px leading-snug text-fg-secondary list-disc",
    "modal-actions": "flex flex-row justify-end gap-2",

    /*
     * Side drawers (Settings / Extensions / Overview / Tasks).
     * Fixed overlay + elevated dark surface + explicit text-fg — without these
     * the panel was a bare flex child (native white form chrome + light text =
     * white-out / "can't close" UX).
     */
    "side-panel-backdrop":
      "fixed inset-0 z-90 bg-overlay animate-overlay-in border-none p-0 m-0 cursor-default",
    "side-panel":
      "fixed top-0 right-0 bottom-0 z-95 w-side-panel max-w-full flex flex-col min-h-0 border-l border-line-subtle bg-elevated text-fg shadow-modal animate-modal-in",
    "side-panel-head":
      "flex items-center justify-between gap-3 shrink-0 px-4 py-3.5 border-b border-line-subtle bg-elevated",
    "side-panel-title":
      "m-0 text-14px font-medium tracking-tight text-fg",
    "side-panel-close":
      "shrink-0 rounded-control border border-line-muted bg-white-soft text-fg px-3 py-1.5 text-12px font-medium transition-colors duration-fast ease-soft hover:(bg-white-hover border-line-strong)",
    "side-panel-body":
      "flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-fg",
    /* Sticky apply region pinned to drawer bottom (always visible while scrolling). */
    "side-panel-footer":
      "shrink-0 sticky bottom-0 z-10 flex flex-col gap-2 px-4 py-3 border-t border-line-subtle bg-elevated",
    "side-panel-footer-dirty":
      "border-t-[color-mix(in_oklch,var(--color-warning)_40%,var(--color-line-subtle))]",
    "side-panel-hint":
      "m-0 text-12px leading-snug text-fg-secondary",
    "side-panel-section":
      "flex flex-col gap-2 pt-2 border-t border-line-subtle",
    "side-panel-section-title":
      "m-0 text-12px font-medium tracking-wide text-fg-secondary",
    "side-panel-section-danger":
      "flex flex-col gap-2 pt-2 border-t border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)]",
    "side-panel-section-title-danger":
      "m-0 text-12px font-medium tracking-wide text-danger",
    "side-panel-actions":
      "flex flex-wrap items-center gap-2",
    "field-label":
      "flex flex-col gap-1.5 text-12px text-fg-secondary",
    "text-input":
      "w-full min-h-9 px-2.5 py-1.75 rounded-control border border-line-muted bg-high text-fg text-12px transition-colors duration-fast ease-soft focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] border-line-focus bg-highest) placeholder:text-fg-muted",
    "check-row":
      "flex items-start gap-2 text-12px leading-snug text-fg cursor-pointer",
    /*
     * Tokenized checkbox — empty = faint fill + strong border (readable on
     * elevated panels); checked = primary fill + on-primary mark; hover border
     * uses focus token, checked-hover uses accent-hover.
     */
    "ui-check":
      "group inline-flex items-start gap-2.5 text-12px leading-snug text-fg cursor-pointer select-none",
    "ui-check-disabled": "opacity-50 cursor-not-allowed pointer-events-none",
    "ui-check-input":
      "absolute opacity-0 w-4 h-4 m-0 peer",
    "ui-check-box":
      "mt-0.5 shrink-0 w-4 h-4 rounded-soft border border-line-strong bg-white-faint flex items-center justify-center transition-colors duration-fast ease-soft group-hover:border-line-focus peer-focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-2 ring-offset-[var(--color-bg-elevated)]) peer-checked:(bg-primary border-primary) peer-checked:group-hover:(bg-accent-hover border-accent-hover)",
    "ui-check-mark":
      "block w-2 h-1.25 border-l-[1.5px] border-b-[1.5px] border-on-primary rotate-[-45deg] translate-y-[-1px] mt-px",
    "ui-check-label": "min-w-0 flex-1",
    "ui-select":
      "w-full min-h-9 px-2.5 py-1.75 rounded-control border border-line-muted bg-high text-fg text-12px transition-colors duration-fast ease-soft appearance-none focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] border-line-focus bg-highest) disabled:opacity-50",
    "ui-select-disabled": "opacity-50 cursor-not-allowed",
    "settings-apply-hint":
      "m-0 text-11px leading-snug text-warning",
    "settings-env-key":
      "text-11px text-fg-muted font-mono",
    "settings-compat-desc":
      "m-0 text-11px leading-snug text-fg-muted",
    "code-block":
      "m-0 max-h-48 overflow-auto rounded-shell bg-high border border-line-subtle px-2.5 py-2 font-mono text-11px leading-relaxed text-fg-secondary whitespace-pre-wrap break-words",
    "row-gap": "flex flex-wrap items-center gap-2",
    "banner-info": "border-line-subtle bg-white-faint text-fg-secondary",

    /* Command palette (⌘K) */
    "palette-panel":
      "w-palette max-w-[92vw] max-h-[min(70vh,560px)] flex flex-col overflow-hidden bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal animate-modal-in",
    "palette-input":
      "w-full shrink-0 border-none border-b border-line-subtle bg-transparent px-4 py-3.5 text-14px text-fg placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-inset ring-[var(--color-focus-ring)])",
    "palette-list":
      "m-0 p-1.5 list-none overflow-y-auto flex-1 min-h-0",
    "palette-item":
      "flex w-full items-center gap-2.5 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "palette-item-active": "bg-white-soft",
    "palette-kind":
      "shrink-0 text-10px uppercase tracking-wide text-fg-muted px-1.5 py-0.5 rounded-pill bg-white-faint",
    "palette-label": "min-w-0 flex-1 text-fg font-medium",
    "palette-desc":
      "min-w-0 flex-1 text-fg-muted text-11px overflow-hidden text-ellipsis whitespace-nowrap",
    "palette-empty": "px-3 py-6 text-center text-12px text-fg-muted",

    /* Multi-session overview rows */
    "overview-bucket":
      "m-0 text-11px font-medium tracking-wide text-fg-muted uppercase",
    "overview-list": "m-0 p-0 list-none flex flex-col gap-1",
    "overview-row":
      "flex w-full items-center justify-between gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "overview-row-live": "bg-white-faint",
    "overview-title":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg",
    "overview-status": "shrink-0 text-11px text-fg-muted",
    "overview-actions": "flex flex-wrap items-center gap-1.5 px-1 pb-1",
    "peek-panel":
      "mt-2 flex flex-col gap-2 rounded-shell border border-line-subtle bg-high p-3",
};
